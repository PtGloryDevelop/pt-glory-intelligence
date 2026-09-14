import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type pg from "pg";
import { connect } from "./helpers.ts";
import {
  failCollection, reconcileOriginalStart, releaseUnresolvedReservation, retryCostReconciliation,
  retrySettlement, type Admin,
} from "../../lib/collect/recovery.ts";
import { advance } from "../../lib/collect/machine.ts";
import { reconcileCost } from "../../lib/collect/cost.ts";
import { createMockProvider, mockRun, type MockProvider, type MockScript } from "../../lib/collect/mock.ts";
import { billingWindow, windowCommitment, microsToUsd, type RequestAccounting } from "../../lib/collect/budget.ts";
import { closePool } from "../../lib/db/privileged.ts";

/**
 * C11 — admin recovery, against the real database.
 *
 * The rule every case here defends: a person may unblock, reconcile by reading,
 * fail, or stop holding money aside. Nobody may buy a second attempt at the same
 * request. A new paid collection is a new request, through admission.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const SOURCE_URL = "https://www.facebook.com/ads/library/?q=test";

const SETTINGS: Record<string, unknown> = {
  "collector.actor_build": "2.7.25",
  "collector.run_timeout_minutes": 10,
  "collector.lease_seconds": 120,
  "collector.reconcile_window_minutes": 30,
  "collector.reconcile_page_size": 20,
  "collector.result_settle_seconds": 30,
  "collector.result_settle_window_minutes": 15,
  "collector.max_export_bytes": 25_000_000,
  "collector.cost_settle_minutes": 15,
  "collector.cost_final_window_hours": 6,
};

async function setSettings(client: pg.Client) {
  for (const [key, value] of Object.entries(SETTINGS)) {
    await client.query(
      `insert into public.app_settings (key, value) values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }
}

async function snapshotSettings(client: pg.Client) {
  const { rows } = await client.query<{ key: string; value: unknown }>(
    "select key, value from public.app_settings where key like 'collector.%'",
  );
  return async () => {
    for (const row of rows) {
      await client.query(
        `insert into public.app_settings (key, value) values ($1, $2::jsonb)
         on conflict (key) do update set value = excluded.value`,
        [row.key, JSON.stringify(row.value)],
      );
    }
  };
}

async function fixtures(client: pg.Client) {
  const user = async (label: string) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $1, '', now(), now(), now())
       returning id`,
      [`c11-${label}-${randomUUID()}@example.test`],
    );
    return rows[0].id;
  };
  const requesterId = await user("requester");
  const adminId = await user("admin");
  const { rows: category } = await client.query<{ id: string }>(
    "insert into public.categories (name) values ($1) returning id",
    [`C11 ${randomUUID().slice(0, 8)}`],
  );
  return { requesterId, adminId, categoryId: category[0].id };
}

const STARTED_AT = new Date(Date.UTC(2026, 8, 11, 9, 9, 12, 548));

async function request(
  client: pg.Client,
  base: { requesterId: string; categoryId: string },
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const columns: Record<string, unknown> = {
    requested_by: base.requesterId,
    request_key: randomUUID(),
    params: JSON.stringify({ keyword: "วิตามิน", country: "TH", active_status: "active", max_records: 300 }),
    category_id: base.categoryId,
    dataset_name: "วิตามิน · TH · 2026-09-11",
    source_url: SOURCE_URL,
    cost_reserved_usd: "0.100000",
    ...overrides,
  };
  const names = Object.keys(columns);
  const placeholders = names.map((name, i) => (name === "params" ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const { rows } = await client.query<{ id: string }>(
    `insert into public.collection_requests (${names.join(", ")})
     values (${placeholders.join(", ")}) returning id`,
    Object.values(columns),
  );
  return rows[0].id;
}

/** A result that would not settle, exactly as C09 leaves it. */
const unsettled = (client: pg.Client, base: { requesterId: string; categoryId: string }, extra: Record<string, unknown> = {}) =>
  request(client, base, {
    status: "settling", requires_admin: true, error_class: "provider_result_unsettled",
    error_detail: "the dataset never settled",
    provider: "apify", provider_run_id: `RUN-${randomUUID()}`, provider_dataset_id: `DS-${randomUUID()}`,
    started_at: STARTED_AT.toISOString(), start_attempted_at: STARTED_AT.toISOString(),
    result_item_count: 117, result_pagination_total: 117,
    result_modified_at: STARTED_AT.toISOString(),
    result_observed_at: STARTED_AT.toISOString(),
    result_settle_started_at: STARTED_AT.toISOString(),
    next_check_at: null,
    ...extra,
  });

/** An unresolved start: a POST went out, and nothing came back that identified a run. */
const uncertain = (client: pg.Client, base: { requesterId: string; categoryId: string }, extra: Record<string, unknown> = {}) =>
  request(client, base, {
    status: "provider_start_uncertain", requires_admin: true,
    start_attempted_at: STARTED_AT.toISOString(), cost_status: "unreported",
    next_check_at: null,
    ...extra,
  });

async function stateOf(client: pg.Client, id: string) {
  const { rows } = await client.query<Record<string, string | number | boolean | Date | null>>(
    `select status, requires_admin, error_class, error_detail, provider_run_id, provider_dataset_id,
            started_at, finished_at, next_check_at, result_item_count, result_pagination_total,
            result_settle_started_at, result_settle_reopened_at, result_observed_at, cost_status, cost_reserved_usd,
            cost_provisional_usd, cost_final_usd, cost_next_check_at, cost_window_reopened_at,
            cost_first_read_at, reservation_released_at, reservation_released_by,
            reservation_release_reason, collection_run_id, dataset_id
       from public.collection_requests where id = $1`,
    [id],
  );
  return rows[0];
}

const auditRows = async (client: pg.Client, id: string) => {
  const { rows } = await client.query<{ action: string; actor: string | null; before: unknown; after: unknown }>(
    "select action, actor, before, after from public.audit_logs where entity_id = $1 order by created_at, id",
    [id],
  );
  return rows;
};

const provider = (script: MockScript = {}): MockProvider =>
  createMockProvider(script, { PT_GLORY_ENV: "test" });

// --- authorization ---------------------------------------------------------------

test("recovery is admin work, decided on the server", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  const restore = await snapshotSettings(client);
  t.after(async () => {
    await client.query("delete from public.collection_requests");
    await restore();
    await client.end();
    await closePool();
  });
  await setSettings(client);

  const denied = [
    { id: base.adminId, role: "viewer" as const },
    { id: base.adminId, role: "analyst" as const },
  ];

  await t.test("every action refuses a viewer and an analyst", async () => {
    const settling = await unsettled(client, base);
    const unknownStart = await uncertain(client, base, {
      status: "failed", error_class: "provider_start_unknown", requires_admin: false,
      finished_at: STARTED_AT.toISOString(),
    });
    for (const actor of denied) {
      await assert.rejects(retrySettlement(settling, actor), /Requires admin role/);
      await assert.rejects(failCollection(settling, actor, "because"), /Requires admin role/);
      await assert.rejects(reconcileOriginalStart(settling, actor, provider()), /Requires admin role/);
      await assert.rejects(retryCostReconciliation(settling, actor), /Requires admin role/);
      await assert.rejects(releaseUnresolvedReservation(unknownStart, actor, "because"), /Requires admin role/);
    }
    // And nothing moved.
    const state = await stateOf(client, settling);
    assert.equal(state.requires_admin, true);
    assert.equal(state.error_class, "provider_result_unsettled");
    assert.deepEqual(await auditRows(client, settling), []);
  });

  await t.test("an admin is still refused when the request is not in the right state", async () => {
    const admin: Admin = { id: base.adminId, role: "admin" };
    const running = await request(client, base, {
      status: "running", provider_run_id: `RUN-${randomUUID()}`, started_at: STARTED_AT.toISOString(),
    });
    const outcome = await retrySettlement(running, admin);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false ? outcome.reason : null, "not_eligible");
    assert.equal((await stateOf(client, running)).status, "running");
  });

  await t.test("no ordinary application route can reach these actions", () => {
    // C11 is internal server work: no route imports it, and its provider
    // dependency is read-only reconciliation only.
    const source = readFileSync("lib/collect/recovery.ts", "utf8");
    assert.doesNotMatch(source, /\.startRun|startRun\(|fetch\(/i);
    assert.match(source, /findOriginalStart/);
    assert.match(source, /requireAdmin\(admin\)/);
    assert.equal(source.match(/requireAdmin\(admin\);/g)?.length, 5, "every exported action checks first");
  });
});

// --- settlement ------------------------------------------------------------------

test("retry settlement reads the same dataset again, and buys nothing", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  const restore = await snapshotSettings(client);
  const admin: Admin = { id: base.adminId, role: "admin" };
  t.after(async () => {
    await client.query("delete from public.collection_requests");
    await restore();
    await client.end();
    await closePool();
  });
  await setSettings(client);

  await t.test("the hold is lifted, the identity and observations stand", async () => {
    const id = await unsettled(client, base);
    const before = await stateOf(client, id);
    const outcome = await retrySettlement(id, admin);
    assert.equal(outcome.ok, true);

    const after = await stateOf(client, id);
    assert.equal(after.requires_admin, false);
    assert.equal(after.error_class, null);
    assert.equal(after.status, "settling", "the request stays where it was");
    assert.equal(after.provider_run_id, before.provider_run_id, "the same run");
    assert.equal(after.provider_dataset_id, before.provider_dataset_id, "the same dataset");
    assert.equal(after.result_item_count, 117, "and everything already observed is kept");
    assert.deepEqual(after.result_settle_started_at, before.result_settle_started_at,
      "the original settlement history is never rewritten");
    assert.ok(after.result_settle_reopened_at, "a fresh operational window anchor is recorded");
    assert.ok(after.next_check_at, "the machine is asked to look again");

    const audit = await auditRows(client, id);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "collection.recovery.settlement_retried");
    assert.equal(audit[0].actor, base.adminId, "the admin who decided, not a worker");
    // The window was reopened, and the historical window start remains on the record.
    assert.equal(
      (audit[0].before as Record<string, string>).settle_window_started_at,
      STARTED_AT.toISOString(),
    );
  });

  await t.test("the resumed machine only reads, and starts nothing", async () => {
    const id = await unsettled(client, base);
    await retrySettlement(id, admin);
    const mock = provider({ datasetMetadata: { itemCount: 133, modifiedAt: STARTED_AT.toISOString() }, itemTotal: 133 });
    const resumed = await advance(id, { provider: mock, worker: "w1", now: new Date() });

    assert.equal(mock.startCount, 0, "no run is ever started by a recovery");
    assert.equal(resumed.action, "result_observed");
    assert.deepEqual(
      mock.calls.map((call) => call.operation),
      ["readDatasetMetadata", "readDatasetItemTotal"],
      "and only the same dataset is read",
    );
  });

  await t.test("two admins retrying at once reopen the window once", async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = await unsettled(client, base);
      const [a, b] = await Promise.all([retrySettlement(id, admin), retrySettlement(id, admin)]);
      const wins = [a, b].filter((result) => result.ok).length;
      assert.equal(wins, 1, `round ${round}: exactly one retry takes effect`);
      const audit = await auditRows(client, id);
      assert.equal(audit.length, 1, `round ${round}: one audit row`);
      assert.equal((await stateOf(client, id)).requires_admin, false);
    }
  });
});

// --- failing a collection --------------------------------------------------------

test("failing a collection keeps every piece of evidence", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  const restore = await snapshotSettings(client);
  const admin: Admin = { id: base.adminId, role: "admin" };
  t.after(async () => {
    await client.query("delete from public.collection_requests");
    await restore();
    await client.end();
    await closePool();
  });
  await setSettings(client);

  await t.test("an unsettled result: failed, with the run, dataset and observations intact", async () => {
    const id = await unsettled(client, base, { cost_status: "provisional", cost_provisional_usd: "0.099800", cost_provisional_observed_at: STARTED_AT.toISOString(), cost_next_check_at: new Date().toISOString() });
    const before = await stateOf(client, id);
    const outcome = await failCollection(id, admin, "the provider never finished writing the dataset");
    assert.equal(outcome.ok, true);

    const after = await stateOf(client, id);
    assert.equal(after.status, "failed");
    assert.equal(after.error_class, "provider_result_unsettled", "the reason it failed is the reason it is recorded under");
    assert.equal(after.provider_run_id, before.provider_run_id);
    assert.equal(after.provider_dataset_id, before.provider_dataset_id);
    assert.equal(after.result_item_count, 117);
    assert.equal(after.collection_run_id, null, "nothing partial was imported");
    assert.equal(after.dataset_id, null, "and no empty dataset was invented");
    assert.ok(after.finished_at);
    // Cost work is nobody's dependent: failing the collection does not cancel it.
    assert.equal(after.cost_status, "provisional");
    assert.equal(after.cost_provisional_usd, "0.099800");
    assert.ok(after.cost_next_check_at, "the bill is still being settled");

    const audit = await auditRows(client, id);
    assert.equal(audit.at(-1)?.action, "collection.recovery.failed");
    assert.equal((audit.at(-1)?.after as Record<string, string>).reason,
      "the provider never finished writing the dataset");
  });

  await t.test("a failed collection's cost keeps reconciling", async () => {
    const id = await unsettled(client, base, { cost_next_check_at: new Date().toISOString() });
    await failCollection(id, admin, "unrecoverable");
    const mock = provider({ run: mockRun({ runId: (await stateOf(client, id)).provider_run_id as string, status: "SUCCEEDED", usage: { reportedTotalUsd: "0.0998", chargedItems: 133, chargedStartEvents: 1 } }) });
    const cost = await reconcileCost(id, { provider: mock, now: new Date(STARTED_AT.getTime() + 60_000) });
    assert.equal(cost.action, "observed");
    assert.equal(mock.startCount, 0);
    assert.equal((await stateOf(client, id)).status, "failed", "and the request is still failed");
  });

  await t.test("a reason is required", async () => {
    const id = await unsettled(client, base);
    const refused = await failCollection(id, admin, "   ");
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false ? refused.reason : null, "reason_required");
    assert.equal((await stateOf(client, id)).status, "settling", "nothing changed");
  });

  await t.test("an identity conflict can be failed, but never overwritten or cleared", async () => {
    const runId = `RUN-A-${randomUUID()}`;
    const id = await request(client, base, {
      status: "running", requires_admin: true, error_class: "provider_identity_conflict",
      error_detail: "provider run identity does not match the run already attached",
      provider: "apify", provider_run_id: runId, provider_dataset_id: "DS-A",
      started_at: STARTED_AT.toISOString(), start_attempted_at: STARTED_AT.toISOString(),
    });
    // There is no action that replaces an identity or clears the conflict.
    const source = readFileSync("lib/collect/recovery.ts", "utf8");
    assert.doesNotMatch(source, /error_class = null[\s\S]{0,400}provider_identity_conflict/);

    // Retrying settlement does not apply to it either.
    const wrongAction = await retrySettlement(id, admin);
    assert.equal(wrongAction.ok, false);
    assert.equal((await stateOf(client, id)).error_class, "provider_identity_conflict");

    // Reconciliation is only eligible while no provider identity is attached;
    // an identity-conflict row must not be used as a write path either.
    const reconcile = await reconcileOriginalStart(id, admin, provider());
    assert.equal(reconcile.ok, false);
    assert.equal(reconcile.ok === false ? reconcile.reason : null, "not_eligible");

    // The one thing an admin may do is fail it, keeping the evidence.
    assert.equal((await failCollection(id, admin, "two runs claim this request")).ok, true);
    const after = await stateOf(client, id);
    assert.equal(after.status, "failed");
    assert.equal(after.error_class, "provider_identity_conflict", "the conflict is still what happened");
    assert.equal(after.provider_run_id, runId, "and the identity first persisted still stands");
  });

  await t.test("manual fail refuses importing after a canonical commit", async () => {
    const id = await request(client, base, {
      status: "importing", requires_admin: true,
      provider: "apify", provider_run_id: `RUN-${randomUUID()}`,
      provider_dataset_id: `DS-${randomUUID()}`,
      import_attempted_at: STARTED_AT.toISOString(),
    });
    const { rows } = await client.query<{ id: string }>(
      `insert into public.collection_runs (
         source_product, collection_method, collector_schema_version, collected_at,
         computed_source_rows, computed_unique_ads, computed_unique_pages,
         computed_unresolved_count, status, reported_quality_summary, created_by
       ) values (
         'fixture', 'apify_actor_run', 'fixture-v1', now(), 1, 1, 1, 0,
         'completed', jsonb_build_object('collection_request_id', $1::text), $2
       ) returning id`,
      [id, base.requesterId],
    );

    const refused = await failCollection(id, admin, "the import worker appears stuck");
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false ? refused.reason : null, "not_eligible");
    assert.equal((await stateOf(client, id)).status, "importing");
    assert.equal((await stateOf(client, id)).collection_run_id, null, "C09 still owns adoption");
    assert.deepEqual(await auditRows(client, id), [], "a refused fail is not a state transition");
    await client.query("delete from public.collection_runs where id = $1", [rows[0].id]);
  });
});

// --- an unresolved start ---------------------------------------------------------

test("an unknown start is resolved by reading, or not at all", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  const restore = await snapshotSettings(client);
  const admin: Admin = { id: base.adminId, role: "admin" };
  t.after(async () => {
    await client.query("delete from public.collection_requests");
    await restore();
    await client.end();
    await closePool();
  });
  await setSettings(client);

  const runFor = (id: string, overrides: Record<string, unknown> = {}) => mockRun({
    runId: `RUN-${randomUUID()}`, status: "RUNNING", finishedAt: null,
    startedAt: STARTED_AT.toISOString(), ...overrides,
  });

  await t.test("exactly one run carrying this request's tag is attached", async () => {
    const id = await uncertain(client, base);
    const found = runFor(id);
    const mock = provider({ runsSince: [found], runInput: { runTag: id, sourceUrl: SOURCE_URL } });
    const resumed = await reconcileOriginalStart(id, admin, mock);

    assert.equal(resumed.ok, true);
    assert.equal(resumed.ok && resumed.action, "original_start_reconciled");
    assert.equal(mock.startCount, 0, "found by reading, never by starting");
    const state = await stateOf(client, id);
    assert.equal(state.status, "running");
    assert.equal(state.provider_run_id, found.runId);
    assert.equal(state.requires_admin, false);
  });

  await t.test("no match leaves it unresolved and back in front of a person", async () => {
    const id = await uncertain(client, base);
    const mock = provider({ runsSince: [] });
    const resumed = await reconcileOriginalStart(id, admin, mock);

    assert.equal(resumed.ok, false);
    assert.equal(resumed.ok === false ? resumed.reason : null, "not_resolved");
    assert.equal(mock.startCount, 0);
    const state = await stateOf(client, id);
    assert.equal(state.status, "provider_start_uncertain");
    assert.equal(state.requires_admin, true, "an attempt is not a resolution");
    assert.equal(state.provider_run_id, null);
    assert.equal(state.error_class, "provider_start_unknown");
    assert.equal((await auditRows(client, id)).at(-1)?.action,
      "collection.recovery.original_start_unresolved");
  });

  await t.test("two candidates are never guessed between", async () => {
    const id = await uncertain(client, base);
    const mock = provider({
      runsSince: [runFor(id), runFor(id)],
      runInput: { runTag: id, sourceUrl: SOURCE_URL },
    });
    const resumed = await reconcileOriginalStart(id, admin, mock);

    assert.equal(resumed.ok, false);
    assert.equal(resumed.ok === false ? resumed.reason : null, "not_resolved");
    assert.equal(mock.startCount, 0);
    const state = await stateOf(client, id);
    assert.equal(state.requires_admin, true);
    assert.equal(state.provider_run_id, null, "no run is attached on a guess");
  });

  await t.test("a run whose tag does not match is not this request's run", async () => {
    const id = await uncertain(client, base);
    const mock = provider({
      runsSince: [runFor(id)],
      runInput: { runTag: randomUUID(), sourceUrl: SOURCE_URL },
    });
    const resumed = await reconcileOriginalStart(id, admin, mock);
    assert.equal(resumed.ok, false);
    assert.equal(resumed.ok === false ? resumed.reason : null, "not_resolved");
    assert.equal((await stateOf(client, id)).provider_run_id, null);
  });

  await t.test("two admins reconciling the original start attach it once", async () => {
    const id = await uncertain(client, base);
    const found = runFor(id);
    const [a, b] = await Promise.all([
      reconcileOriginalStart(id, admin, provider({
        runsSince: [found], runInput: { runTag: id, sourceUrl: SOURCE_URL },
      })),
      reconcileOriginalStart(id, admin, provider({
        runsSince: [found], runInput: { runTag: id, sourceUrl: SOURCE_URL },
      })),
    ]);
    assert.equal([a, b].filter((result) => result.ok).length, 1);
    assert.equal((await stateOf(client, id)).provider_run_id, found.runId);
    assert.equal((await auditRows(client, id)).length, 1, "one effective recovery audit");
  });

  await t.test("failing it keeps the reservation held and the cost unreported", async () => {
    const id = await uncertain(client, base);
    assert.equal((await failCollection(id, admin, "the run could not be identified")).ok, true);
    const state = await stateOf(client, id);
    assert.equal(state.status, "failed");
    assert.equal(state.error_class, "provider_start_unknown");
    assert.equal(state.cost_status, "unreported");
    assert.equal(state.cost_reserved_usd, "0.100000", "failing does not release what is held");
    assert.equal(state.reservation_released_at, null);
    assert.equal(state.cost_next_check_at, null, "and no run means no cost polling");
  });
});

// --- cost retry ------------------------------------------------------------------

test("an admin may ask about the bill again, and only ever by reading", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  const restore = await snapshotSettings(client);
  const admin: Admin = { id: base.adminId, role: "admin" };
  t.after(async () => {
    await client.query("delete from public.collection_requests");
    await restore();
    await client.end();
    await closePool();
  });
  await setSettings(client);

  const stopped = (extra: Record<string, unknown> = {}) => request(client, base, {
    status: "succeeded", finished_at: STARTED_AT.toISOString(),
    provider: "apify", provider_run_id: `RUN-${randomUUID()}`, provider_dataset_id: `DS-${randomUUID()}`,
    started_at: STARTED_AT.toISOString(), start_attempted_at: STARTED_AT.toISOString(),
    cost_status: "provisional", cost_provisional_usd: "0.099800",
    cost_provisional_observed_at: STARTED_AT.toISOString(),
    cost_first_read_at: STARTED_AT.toISOString(), cost_next_check_at: null,
    ...extra,
  });

  await t.test("a stopped reconciliation is reopened, and nothing else changes", async () => {
    const id = await stopped();
    const before = await stateOf(client, id);
    assert.equal((await retryCostReconciliation(id, admin)).ok, true);

    const after = await stateOf(client, id);
    assert.ok(after.cost_next_check_at, "it is due again");
    assert.ok(after.cost_window_reopened_at, "with a window that can actually run");
    assert.equal(after.cost_status, before.cost_status, "no status is promoted by asking");
    assert.equal(after.cost_provisional_usd, "0.099800");
    assert.equal(after.cost_final_usd, null);
    assert.equal(after.cost_first_read_at as Date | null && (after.cost_first_read_at as Date).toISOString(),
      STARTED_AT.toISOString(), "the first read ever is untouched");
    assert.equal(after.started_at as Date | null && (after.started_at as Date).toISOString(),
      STARTED_AT.toISOString(), "and so is the charge-bearing start");
    assert.equal(after.status, "succeeded", "the lifecycle is not disturbed");
    assert.equal(auditActionOf(await auditRows(client, id)), "collection.recovery.cost_retried");
  });

  await t.test("the reopened window lets C10 finish the job, by GET", async () => {
    const id = await stopped();
    await retryCostReconciliation(id, admin);
    const runId = (await stateOf(client, id)).provider_run_id as string;
    const run = mockRun({ runId, status: "SUCCEEDED", usage: { reportedTotalUsd: "0.0998", chargedItems: 133, chargedStartEvents: 1 } });

    // Days after the run: without the reopen this window would be long spent
    // and C10 would stop again before reading anything.
    const later = new Date(STARTED_AT.getTime() + 3 * 24 * 3_600_000);
    const mock = provider({ run });
    const settled = await reconcileCost(id, { provider: mock, now: later });

    // The figure recorded before the window closed is one of the two agreeing
    // reads, and this one is far past the settle interval.
    assert.equal(settled.action, "finalized");
    assert.equal(mock.startCount, 0, "every cost operation is a read");
    assert.deepEqual(mock.calls.map((call) => call.operation), ["readRun"]);
    assert.equal((await stateOf(client, id)).cost_final_usd, "0.099800");
  });

  await t.test("an unreported cost may be reopened too", async () => {
    const id = await stopped({ cost_status: "unreported", cost_provisional_usd: null, cost_provisional_observed_at: null, cost_first_read_at: null });
    assert.equal((await retryCostReconciliation(id, admin)).ok, true);
    assert.equal((await stateOf(client, id)).cost_status, "unreported", "asking again promotes nothing");
  });

  await t.test("with no identified run the action is refused", async () => {
    const id = await uncertain(client, base, {
      status: "failed", error_class: "provider_start_unknown", requires_admin: false,
      finished_at: STARTED_AT.toISOString(),
    });
    const refused = await retryCostReconciliation(id, admin);
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false ? refused.reason : null, "not_eligible");
    assert.equal((await stateOf(client, id)).cost_next_check_at, null, "no run is searched for on billing's account");
  });

  await t.test("a settled cost is not reopened", async () => {
    const id = await stopped({ cost_status: "final", cost_final_usd: "0.099800", cost_finalized_at: STARTED_AT.toISOString() });
    assert.equal((await retryCostReconciliation(id, admin)).ok, false);
  });

  await t.test("two admins retrying at once reopen once", async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = await stopped();
      const [a, b] = await Promise.all([retryCostReconciliation(id, admin), retryCostReconciliation(id, admin)]);
      assert.equal([a, b].filter((result) => result.ok).length, 1, `round ${round}`);
      assert.equal((await auditRows(client, id)).length, 1, `round ${round}: one audit row`);
    }
  });
});

const auditActionOf = (rows: { action: string }[]) => rows.at(-1)?.action ?? null;

// --- releasing a reservation nobody can resolve -----------------------------------

test("releasing a held reservation is an accounting act, and says nothing else", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  const restore = await snapshotSettings(client);
  const admin: Admin = { id: base.adminId, role: "admin" };
  t.after(async () => {
    await client.query("delete from public.collection_requests");
    await restore();
    await client.end();
    await closePool();
  });
  await setSettings(client);

  const unresolved = (extra: Record<string, unknown> = {}) => uncertain(client, base, {
    status: "failed", error_class: "provider_start_unknown", requires_admin: false,
    finished_at: STARTED_AT.toISOString(), ...extra,
  });

  await t.test("the hold is released, and everything else is left alone", async () => {
    const id = await unresolved();
    const before = await stateOf(client, id);
    const outcome = await releaseUnresolvedReservation(id, admin, "no evidence of a run after three days");
    assert.equal(outcome.ok, true);

    const after = await stateOf(client, id);
    assert.ok(after.reservation_released_at);
    assert.equal(after.reservation_released_by, base.adminId);
    assert.equal(after.reservation_release_reason, "no evidence of a run after three days");
    assert.equal(after.cost_status, "unreported", "this is not a claim that nothing was charged");
    assert.equal(after.cost_reserved_usd, before.cost_reserved_usd, "the historical reservation is not rewritten");
    assert.equal(after.cost_final_usd, null);
    assert.equal(after.status, "failed", "and the request is still failed and unresolved");
    assert.equal(after.error_class, "provider_start_unknown");
    assert.equal(after.provider_run_id, null);

    const audit = await auditRows(client, id);
    assert.equal(audit.at(-1)?.action, "collection.recovery.reservation_released");
    assert.equal(audit.at(-1)?.actor, base.adminId);
    const recorded = audit.at(-1)?.after as Record<string, unknown>;
    assert.equal(recorded.released_hold_usd, "0.100000");
    assert.equal(recorded.cost_status, "unreported");
  });

  await t.test("a reason is required", async () => {
    const id = await unresolved();
    const refused = await releaseUnresolvedReservation(id, admin, "  ");
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false ? refused.reason : null, "reason_required");
    assert.equal((await stateOf(client, id)).reservation_released_at, null);
  });

  await t.test("a request with an identified run is refused", async () => {
    const id = await unresolved({ provider_run_id: `RUN-${randomUUID()}` });
    assert.equal((await releaseUnresolvedReservation(id, admin, "because")).ok, false);
    assert.equal((await stateOf(client, id)).reservation_released_at, null);
  });

  await t.test("a cost that is not unreported is refused", async () => {
    const id = await unresolved({ cost_status: "reserved" });
    assert.equal((await releaseUnresolvedReservation(id, admin, "because")).ok, false);
  });

  await t.test("releasing twice changes nothing the second time", async () => {
    const id = await unresolved();
    assert.equal((await releaseUnresolvedReservation(id, admin, "first")).ok, true);
    const after = await stateOf(client, id);
    const repeat = await releaseUnresolvedReservation(id, admin, "second");
    assert.equal(repeat.ok, false);
    assert.deepEqual(await stateOf(client, id), after, "not one column moved");
    assert.equal((await auditRows(client, id)).length, 1, "and no second release was recorded");
  });

  await t.test("two admins releasing at once release once", async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = await unresolved();
      const [a, b] = await Promise.all([
        releaseUnresolvedReservation(id, admin, "race a"),
        releaseUnresolvedReservation(id, admin, "race b"),
      ]);
      assert.equal([a, b].filter((result) => result.ok).length, 1, `round ${round}: one release`);
      assert.equal((await auditRows(client, id)).length, 1, `round ${round}: one audit row`);
    }
  });

  await t.test("the budget holds less, and nothing was spent", async () => {
    const id = await unresolved();
    const window = billingWindow("2026-09-01", 1, new Date("2026-09-11T12:00:00Z"));
    assert.ok(window);

    const accounting = async (): Promise<RequestAccounting> => {
      const { rows } = await client.query<RequestAccounting>(
        `select status, cost_status, cost_reserved_usd, cost_provisional_usd, cost_final_usd,
                reservation_released_at, started_at
           from public.collection_requests where id = $1`,
        [id],
      );
      return rows[0];
    };

    const held = windowCommitment([await accounting()], window);
    assert.ok(held.ok);
    assert.equal(microsToUsd(held.commitment.heldReservationMicros), "0.100000");
    assert.equal(held.commitment.finalizedActualCostMicros, 0n);

    await releaseUnresolvedReservation(id, admin, "released for the budget");

    const released = windowCommitment([await accounting()], window);
    assert.ok(released.ok);
    assert.equal(released.commitment.heldReservationMicros, 0n, "the hold is gone");
    assert.equal(released.commitment.finalizedActualCostMicros, 0n,
      "and no actual cost appeared: nothing was spent, reduced or refunded");
  });
});
