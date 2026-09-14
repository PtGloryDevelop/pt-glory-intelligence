import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type pg from "pg";
import { connect } from "./helpers.ts";
import {
  FIRST_CHECK_SECONDS, MAX_CHECK_SECONDS, RUN_MEMORY_MBYTES, advance, backoffSeconds,
} from "../../lib/collect/machine.ts";
import { createMockProvider, mockRun, type MockProvider, type MockScript } from "../../lib/collect/mock.ts";
import { closePool } from "../../lib/db/privileged.ts";
import type { ProviderRun, StartOutcome, StartRequest } from "../../lib/collect/provider.ts";

/**
 * C08 — the state machine, against the real database and a scripted provider.
 *
 * The number every case is really about: how many provider starts happened. A
 * request gets one automatic start, ever, and no failure mode may produce a
 * second one.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const SOURCE_URL = "https://www.facebook.com/ads/library/?q=test";

const SETTINGS: Record<string, unknown> = {
  "collector.actor_build": "2.7.25",
  "collector.run_timeout_minutes": 10,
  "collector.lease_seconds": 120,
  "collector.reconcile_window_minutes": 30,
  "collector.reconcile_page_size": 20,
};

async function setSettings(client: pg.Client, overrides: Record<string, unknown> = {}) {
  for (const [key, value] of Object.entries({ ...SETTINGS, ...overrides })) {
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
  const { rows: user } = await client.query<{ id: string }>(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                             email_confirmed_at, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
             'authenticated', $1, '', now(), now(), now())
     returning id`,
    [`c08-${randomUUID()}@example.test`],
  );
  const { rows: category } = await client.query<{ id: string }>(
    "insert into public.categories (name) values ($1) returning id",
    [`C08 ${randomUUID().slice(0, 8)}`],
  );
  return { userId: user[0].id, categoryId: category[0].id };
}

/** One admitted request, as C07 would have left it. */
async function queuedRequest(
  client: pg.Client,
  base: { userId: string; categoryId: string },
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const columns: Record<string, unknown> = {
    requested_by: base.userId,
    request_key: randomUUID(),
    params: JSON.stringify({ keyword: "วิตามิน", country: "TH", active_status: "active", max_records: 300 }),
    category_id: base.categoryId,
    source_url: SOURCE_URL,
    cost_reserved_usd: "0.100000",
    next_check_at: new Date().toISOString(),
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

const provider = (script: MockScript = {}): MockProvider =>
  createMockProvider(script, { PT_GLORY_ENV: "test" });

async function stateOf(client: pg.Client, id: string) {
  const { rows } = await client.query<{
    status: string; provider_run_id: string | null; provider_dataset_id: string | null;
    started_at: string | null; finished_at: string | null; error_class: string | null;
    error_detail: string | null; requires_admin: boolean; next_check_at: string | null;
    lease_owner: string | null; cost_reserved_usd: string; start_attempted_at: string | null;
  }>(
    `select status, provider_run_id, provider_dataset_id, started_at, finished_at, error_class,
            error_detail, requires_admin, next_check_at, lease_owner, cost_reserved_usd,
            start_attempted_at
       from public.collection_requests where id = $1`,
    [id],
  );
  return rows[0];
}

const auditActions = async (client: pg.Client, id: string) => {
  const { rows } = await client.query<{ action: string }>(
    "select action from public.audit_logs where entity_id = $1 order by id", [id],
  );
  return rows.map((row) => row.action);
};

test("the machine moves one step at a time", { skip }, async (t) => {
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

  await t.test("queued becomes running, and the provider's own start time is kept", async () => {
    const id = await queuedRequest(client, base);
    const run = mockRun({ runId: "RUN-A", datasetId: "DS-A", startedAt: "2026-09-11T09:09:12.548Z" });
    const mock = provider({ start: { outcome: "started", run } });

    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "started");
    assert.equal(outcome.to, "running");
    assert.equal(mock.startCount, 1);

    const state = await stateOf(client, id);
    assert.equal(state.status, "running");
    assert.equal(state.provider_run_id, "RUN-A");
    assert.equal(state.provider_dataset_id, "DS-A");
    assert.equal(new Date(state.started_at ?? "").toISOString(), "2026-09-11T09:09:12.548Z");
    assert.equal(state.lease_owner, null, "the lease is released");
    assert.equal(state.cost_reserved_usd, "0.100000", "admission's reservation is untouched");
    assert.deepEqual(await auditActions(client, id), ["collection.start_attempted", "collection.started"]);
  });

  await t.test("a run with no start time of its own leaves started_at unset", async () => {
    const id = await queuedRequest(client, base);
    const mock = provider({ start: { outcome: "started", run: mockRun({ runId: "RUN-B", startedAt: null }) } });
    await advance(id, { provider: mock, worker: "w1" });
    const state = await stateOf(client, id);
    assert.equal(state.status, "running");
    assert.equal(state.started_at, null, "nothing is invented for the cost attribution to use");
  });

  await t.test("a definitive refusal fails the request, and never starts again", async () => {
    const id = await queuedRequest(client, base);
    const mock = provider({ start: { outcome: "refused", reason: "rejected", detail: "http 400: invalid-input" } });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "start_refused");
    const state = await stateOf(client, id);
    assert.equal(state.status, "failed");
    assert.equal(state.error_class, "provider_start_failed");
    assert.ok(state.finished_at, "a terminal request carries a finish time");

    // Nothing claims a terminal request again.
    const again = await advance(id, { provider: mock, worker: "w2" });
    assert.equal(again.action, "not_claimed");
    assert.equal(mock.startCount, 1);
  });

  await t.test("an unknown start outcome becomes uncertain and stops", async () => {
    const id = await queuedRequest(client, base);
    const mock = provider({ start: { outcome: "unknown", detail: "no answer" } });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "start_uncertain");
    const state = await stateOf(client, id);
    assert.equal(state.status, "provider_start_uncertain");
    assert.equal(state.provider_run_id, null);
    assert.ok(state.start_attempted_at, "the attempt is still recorded");
    assert.equal(mock.startCount, 1);
  });

  await t.test("a worker that died mid-start leaves the request uncertain, not restarted", async () => {
    const id = await queuedRequest(client, base, {
      status: "starting", start_attempted_at: new Date().toISOString(),
      lease_owner: "dead-worker", lease_expires_at: new Date(Date.now() - 1_000).toISOString(),
    });
    const mock = provider();
    const outcome = await advance(id, { provider: mock, worker: "w2" });
    assert.equal(outcome.action, "start_uncertain");
    assert.equal((await stateOf(client, id)).status, "provider_start_uncertain");
    assert.equal(mock.startCount, 0, "a dead worker's attempt is never repeated");
  });

  await t.test("incomplete configuration sends nothing and returns the request to the queue", async () => {
    await setSettings(client, { "collector.actor_build": null });
    const id = await queuedRequest(client, base);
    const mock = provider();
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "not_configured");
    assert.equal(mock.startCount, 0);
    const state = await stateOf(client, id);
    assert.equal(state.status, "queued");
    assert.equal(state.start_attempted_at, null, "the marker is cleared, so a fixed configuration can start it");
    await setSettings(client);
  });
});

test("a running request is polled, never restarted", { skip }, async (t) => {
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

  /** A request with a run attached, and the id the provider must answer with. */
  const running = async (overrides: Record<string, unknown> = {}) => {
    const runId = `RUN-${randomUUID()}`;
    const id = await queuedRequest(client, base, {
      status: "running", provider_run_id: runId,
      started_at: "2026-09-11T09:09:12.548Z", ...overrides,
    });
    return { id, runId };
  };

  await t.test("still running stays running, with a later next check", async () => {
    const { id, runId } = await running();
    const mock = provider({ run: mockRun({ runId, status: "RUNNING", finishedAt: null }) });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "still_running");
    const state = await stateOf(client, id);
    assert.equal(state.status, "running");
    assert.ok(state.next_check_at, "and it is scheduled to be looked at again");
    assert.equal(mock.startCount, 0);
  });

  await t.test("a successful run moves to settling, never straight to importing", async () => {
    const { id, runId } = await running();
    const mock = provider({ run: mockRun({ runId, status: "SUCCEEDED" }) });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "provider_succeeded");
    const state = await stateOf(client, id);
    assert.equal(state.status, "settling", "the settlement gate owns what happens next");
    assert.equal(state.next_check_at, null, "and C09 schedules its own work");
    assert.equal(mock.startCount, 0);
    assert.ok((await auditActions(client, id)).includes("collection.provider_succeeded"));
  });

  await t.test("a terminal provider failure fails the request with its own class", async () => {
    for (const [status, errorClass] of [
      ["FAILED", "provider_run_failed"], ["TIMED-OUT", "provider_timed_out"], ["ABORTED", "provider_aborted"],
    ] as const) {
      const { id, runId } = await running();
      const mock = provider({ run: mockRun({ runId, status }) });
      const outcome = await advance(id, { provider: mock, worker: "w1" });
      assert.equal(outcome.action, "provider_failed", status);
      const state = await stateOf(client, id);
      assert.equal(state.status, "failed", status);
      assert.equal(state.error_class, errorClass, status);
      assert.ok(state.finished_at, status);
    }
  });

  await t.test("a status nobody documented is not success", async () => {
    const { id, runId } = await running();
    const unknown = { ...mockRun({ runId, status: "RUNNING" }), status: "SOMETHING_NEW" } as unknown as ProviderRun;
    const mock = provider({ run: { ...unknown, terminal: false, succeeded: false } });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "still_running");
    assert.equal((await stateOf(client, id)).status, "running", "never settling, never succeeded");
  });

  await t.test("fifty polls start nothing", async () => {
    const { id, runId } = await running();
    const mock = provider({ run: mockRun({ runId, status: "RUNNING", finishedAt: null }) });
    for (let i = 0; i < 50; i += 1) {
      await client.query("update public.collection_requests set next_check_at = now() where id = $1", [id]);
      await advance(id, { provider: mock, worker: `w${i}` });
    }
    assert.equal(mock.startCount, 0, "polling is a GET path, and only a GET path");
    assert.equal((await stateOf(client, id)).status, "running");
  });

  await t.test("a settling request is left alone by this machine", async () => {
    const { id } = await running({ status: "settling" });
    const mock = provider({ run: mockRun() });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "not_claimed");
    assert.equal(mock.startCount, 0);
    assert.equal(mock.calls.length, 0, "and it is not even read: C09 owns this state");
    assert.equal((await stateOf(client, id)).status, "settling");
  });
});

test("contradictory provider evidence stops the request rather than moving it", { skip }, async (t) => {
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

  const attached = async (overrides: Record<string, unknown> = {}) => queuedRequest(client, base, {
    status: "running", provider_run_id: `RUN-A-${randomUUID()}`,
    started_at: "2026-09-11T09:09:12.548Z", ...overrides,
  });

  await t.test("the same identity coming back is fine", async () => {
    const id = await attached();
    const runId = (await stateOf(client, id)).provider_run_id!;
    const mock = provider({ run: mockRun({ runId, status: "SUCCEEDED", startedAt: "2026-09-11T09:09:12.548Z" }) });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "provider_succeeded");
    assert.equal((await stateOf(client, id)).status, "settling");
  });

  await t.test("a different run id stops everything", async () => {
    const id = await attached();
    const before = await stateOf(client, id);
    const mock = provider({ run: mockRun({ runId: "RUN-B", status: "SUCCEEDED", startedAt: "2026-09-11T09:09:12.548Z" }) });

    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "identity_conflict");
    const after = await stateOf(client, id);
    assert.equal(after.status, "running", "a conflicting response never moves the request");
    assert.equal(after.provider_run_id, before.provider_run_id, "the attached run stands");
    assert.equal(after.requires_admin, true);
    assert.equal(after.error_class, "provider_identity_conflict",
      "the conflict has its own class, and borrows neither uncertain-start nor unsettled-result");
    assert.match(after.error_detail ?? "", /run identity/);
  });

  await t.test("a dataset id may be filled once, and never changed", async () => {
    const filled = await attached();
    const runId = (await stateOf(client, filled)).provider_run_id!;
    const first = provider({ run: mockRun({ runId, status: "RUNNING", finishedAt: null, datasetId: "DS-A", startedAt: "2026-09-11T09:09:12.548Z" }) });
    await advance(filled, { provider: first, worker: "w1" });
    assert.equal((await stateOf(client, filled)).provider_dataset_id, "DS-A");

    await client.query("update public.collection_requests set next_check_at = now() where id = $1", [filled]);
    const second = provider({ run: mockRun({ runId, status: "SUCCEEDED", datasetId: "DS-B", startedAt: "2026-09-11T09:09:12.548Z" }) });
    const outcome = await advance(filled, { provider: second, worker: "w2" });
    assert.equal(outcome.action, "identity_conflict");
    const state = await stateOf(client, filled);
    assert.equal(state.provider_dataset_id, "DS-A", "the first dataset stands");
    assert.equal(state.status, "running", "and the request did not reach settling");
    assert.equal(state.requires_admin, true);
  });

  await t.test("a different start time never redefines cost attribution", async () => {
    const id = await attached();
    const runId = (await stateOf(client, id)).provider_run_id!;
    const mock = provider({ run: mockRun({ runId, status: "SUCCEEDED", startedAt: "2026-09-11T10:00:00.000Z" }) });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "identity_conflict");
    const state = await stateOf(client, id);
    assert.equal(new Date(state.started_at ?? "").toISOString(), "2026-09-11T09:09:12.548Z");
    assert.equal(state.status, "running");
  });

  await t.test("a start under a second apart is a different start, not a rounding difference", async () => {
    // 400ms apart, and on opposite sides of a Bangkok-midnight cycle boundary.
    const id = await attached({ started_at: "2026-09-30T16:59:59.700Z" });
    const runId = (await stateOf(client, id)).provider_run_id!;
    const mock = provider({ run: mockRun({ runId, status: "SUCCEEDED", startedAt: "2026-09-30T17:00:00.100Z" }) });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "identity_conflict");
    const state = await stateOf(client, id);
    assert.equal(new Date(state.started_at ?? "").toISOString(), "2026-09-30T16:59:59.700Z",
      "the start that cost attribution is built on never moves");
    assert.equal(state.status, "running");
    assert.equal(state.error_class, "provider_identity_conflict");
  });

  await t.test("the same instant reported in another offset is not a conflict", async () => {
    const id = await attached();
    const runId = (await stateOf(client, id)).provider_run_id!;
    const mock = provider({ run: mockRun({ runId, status: "RUNNING", finishedAt: null, startedAt: "2026-09-11T16:09:12.548+07:00" }) });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "still_running");
    assert.equal((await stateOf(client, id)).error_class, null);
  });

  await t.test("the conflict class replaces an earlier one rather than hiding behind it", async () => {
    const id = await attached({ error_class: "provider_unreachable" });
    const runId = (await stateOf(client, id)).provider_run_id!;
    const mock = provider({ run: mockRun({ runId: `${runId}-other`, status: "SUCCEEDED", startedAt: "2026-09-11T09:09:12.548Z" }) });
    assert.equal((await advance(id, { provider: mock, worker: "w1" })).action, "identity_conflict");
    assert.equal((await stateOf(client, id)).error_class, "provider_identity_conflict");
  });

  await t.test("a different build is not silently accepted", async () => {
    const id = await attached({ provider_actor_build: "2.7.25" });
    const runId = (await stateOf(client, id)).provider_run_id!;
    const mock = provider({ run: mockRun({ runId, status: "SUCCEEDED", buildNumber: "9.9.9", startedAt: "2026-09-11T09:09:12.548Z" }) });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "identity_conflict");
    const state = await stateOf(client, id);
    assert.equal(state.status, "running");
    assert.equal(state.requires_admin, true);
  });
});

test("the start carries exactly what admission authorized", { skip }, async (t) => {
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

  await t.test("reservation, pinned build, memory, runTag and record cap", async () => {
    const id = await queuedRequest(client, base, { cost_reserved_usd: "0.123456" });
    const seen: StartRequest[] = [];
    const mock = provider({
      start: (request) => {
        seen.push(request);
        return { outcome: "started", run: mockRun({ runId: `RUN-${randomUUID()}` }) };
      },
    });

    await advance(id, { provider: mock, worker: "w1" });
    assert.equal(seen.length, 1);
    const [sent] = seen;
    assert.equal(sent.maxTotalChargeUsd, "0.123456", "the persisted reservation, digit for digit");
    assert.equal(sent.build, "2.7.25", "the pinned build from settings");
    assert.equal(sent.memoryMbytes, RUN_MEMORY_MBYTES);
    assert.equal(sent.runTag, id, "the request's own id, deterministically");
    assert.equal(sent.maxRecords, 300);
    assert.equal(sent.timeoutSeconds, 600);
    assert.equal(sent.sourceUrl, SOURCE_URL);

    // Restart behaviour belongs to the client, and nothing here retries.
    await client.query("update public.collection_requests set next_check_at = now() where id = $1", [id]);
    await advance(id, { provider: mock, worker: "w2" });
    assert.equal(mock.startCount, 1, "a second advance never posts again");
  });

  await t.test("the execution constants are pinned", () => {
    assert.equal(RUN_MEMORY_MBYTES, 512, "a qualified execution configuration, not a budget");
    assert.equal(FIRST_CHECK_SECONDS, 20);
    assert.equal(backoffSeconds(1), FIRST_CHECK_SECONDS);
    assert.equal(backoffSeconds(2), FIRST_CHECK_SECONDS * 2, "factor of two");
    assert.equal(MAX_CHECK_SECONDS, 300);
    assert.equal(backoffSeconds(99), MAX_CHECK_SECONDS);
  });
});

test("an uncertain start is reconciled by reading, never by starting", { skip }, async (t) => {
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

  const uncertain = async (attemptedMinutesAgo = 1) => queuedRequest(client, base, {
    status: "provider_start_uncertain",
    start_attempted_at: new Date(Date.now() - attemptedMinutesAgo * 60_000).toISOString(),
  });

  await t.test("exactly one matching run is attached", async () => {
    const id = await uncertain();
    const run = mockRun({ runId: "RUN-MATCH", keyValueStoreId: "KV-MATCH", startedAt: "2026-09-11T09:09:12.548Z" });
    const mock = provider({ runsSince: [run], runInput: { runTag: id, sourceUrl: SOURCE_URL } });

    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "reconciled");
    const state = await stateOf(client, id);
    assert.equal(state.status, "running");
    assert.equal(state.provider_run_id, "RUN-MATCH");
    assert.equal(new Date(state.started_at ?? "").toISOString(), "2026-09-11T09:09:12.548Z");
    assert.equal(mock.startCount, 0, "reconciliation is read-only");
    assert.ok((await auditActions(client, id)).includes("collection.reconciled"));
  });

  await t.test("a run belonging to another request is not a match", async () => {
    const id = await uncertain();
    const mock = provider({
      runsSince: [mockRun({ runId: "RUN-OTHER", keyValueStoreId: "KV-OTHER" })],
      runInput: { runTag: randomUUID(), sourceUrl: SOURCE_URL },
    });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "reconcile_unresolved");
    const state = await stateOf(client, id);
    assert.equal(state.status, "provider_start_uncertain");
    assert.equal(state.requires_admin, false, "still inside the window");
    assert.equal(mock.startCount, 0);
  });

  await t.test("no match after the window asks a person", async () => {
    const id = await uncertain(45);
    const mock = provider({ runsSince: [] });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "reconcile_unresolved");
    const state = await stateOf(client, id);
    assert.equal(state.status, "provider_start_uncertain");
    assert.equal(state.requires_admin, true);
    assert.equal(mock.startCount, 0);
  });

  await t.test("two runs carrying the same tag are never guessed between", async () => {
    const id = await uncertain();
    const mock = provider({
      runsSince: [
        mockRun({ runId: "RUN-1", keyValueStoreId: "KV-1" }),
        mockRun({ runId: "RUN-2", keyValueStoreId: "KV-2" }),
      ],
      runInput: { runTag: id, sourceUrl: SOURCE_URL },
    });
    const outcome = await advance(id, { provider: mock, worker: "w1" });
    assert.equal(outcome.action, "reconcile_ambiguous");
    const state = await stateOf(client, id);
    assert.equal(state.requires_admin, true);
    assert.equal(state.provider_run_id, null, "neither run is attached");
    assert.equal(mock.startCount, 0);
  });

  await t.test("repeated advances on an uncertain request never POST", async () => {
    const id = await uncertain();
    const mock = provider({ runsSince: [] });
    for (let i = 0; i < 10; i += 1) {
      await client.query(
        "update public.collection_requests set next_check_at = now(), requires_admin = false where id = $1", [id],
      );
      await advance(id, { provider: mock, worker: `w${i}` });
    }
    assert.equal(mock.startCount, 0, "ten ticks, zero starts");
  });
});

test("two workers on one request produce one start", { skip }, async (t) => {
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

  await t.test("a queued request claimed twice at once starts once, ten rounds over", async () => {
    for (let round = 0; round < 10; round += 1) {
      const id = await queuedRequest(client, base);
      // One provider instance, so both workers share the start counter.
      const mock = provider({ start: { outcome: "started", run: mockRun({ runId: `RUN-${round}` }) } });

      const [a, b] = await Promise.all([
        advance(id, { provider: mock, worker: "worker-a" }),
        advance(id, { provider: mock, worker: "worker-b" }),
      ]);
      assert.equal(mock.startCount, 1, `round ${round}: exactly one provider start`);
      const actions = [a.action, b.action].sort();
      assert.deepEqual(actions, ["not_claimed", "started"], `round ${round}`);
      assert.equal((await stateOf(client, id)).status, "running", `round ${round}`);
    }
  });

  await t.test("a worker that dies after the start evidence is persisted does not start again", async () => {
    const id = await queuedRequest(client, base);
    const started: StartOutcome = { outcome: "started", run: mockRun({ runId: "RUN-KEEP" }) };
    const first = provider({ start: started });
    await advance(id, { provider: first, worker: "worker-a" });

    // The next worker finds the persisted run and polls it.
    await client.query("update public.collection_requests set next_check_at = now() where id = $1", [id]);
    const second = provider({ start: started, run: mockRun({ runId: "RUN-KEEP", status: "RUNNING", finishedAt: null }) });
    const outcome = await advance(id, { provider: second, worker: "worker-b" });
    assert.equal(outcome.action, "still_running");
    assert.equal(second.startCount, 0, "persisted evidence is what the next worker continues from");
  });

  await t.test("a held lease keeps a second worker out until it expires", async () => {
    const id = await queuedRequest(client, base, {
      status: "running", provider_run_id: "RUN-LEASED",
      lease_owner: "worker-a", lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const mock = provider({ run: mockRun({ runId: "RUN-LEASED", status: "RUNNING", finishedAt: null }) });
    assert.equal((await advance(id, { provider: mock, worker: "worker-b" })).action, "not_claimed");
    assert.equal(mock.calls.length, 0, "a leased request is not even read");

    // Once the lease has expired, the work is claimable again.
    await client.query(
      "update public.collection_requests set lease_expires_at = now() - interval '1 second' where id = $1", [id],
    );
    assert.equal((await advance(id, { provider: mock, worker: "worker-b" })).action, "still_running");
  });
});

test("the machine keeps provider detail and secrets where they belong", { skip: false }, () => {
  const source = readFileSync("lib/collect/machine.ts", "utf8");
  // No token, no header, no provider URL is ever written by this module.
  assert.doesNotMatch(source, /APIFY_TOKEN|Authorization|Bearer|api\.apify/);
  // Provider text is scrubbed before it can reach a column.
  assert.match(source, /scrubProviderMessage/);
  // Identifiers go to the admin columns only; the user-safe group is untouched
  // beyond the status the requester's own screen needs.
  assert.doesNotMatch(source, /update public\.collection_requests[\s\S]*?set[\s\S]*?params =/);
  assert.match(source, /provider_run_id = coalesce/);
  // Identity is compared exactly, at the boundary's canonical precision. No
  // elapsed-time tolerance may creep back in: a cycle boundary is sub-second.
  assert.match(source, /canonicalInstant/);
  // No elapsed-time arithmetic on instants: that is what a tolerance is made of.
  assert.doesNotMatch(source, /Math\.abs\([^)]*getTime\(\)/);
  // The start is the only write path to the provider, and it lives in one place.
  assert.equal(source.match(/provider\.startRun\(/g)?.length, 1);
});

test("the back-off grows and then stops growing", { skip: false }, () => {
  assert.equal(backoffSeconds(1), 20);
  assert.equal(backoffSeconds(2), 40);
  assert.equal(backoffSeconds(5), 300, "capped rather than unbounded");
  assert.equal(backoffSeconds(50), 300);
});
