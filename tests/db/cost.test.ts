import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type pg from "pg";
import { connect } from "./helpers.ts";
import { reconcileCost, COST_CLAIM_SECONDS } from "../../lib/collect/cost.ts";
import { closePool } from "../../lib/db/privileged.ts";
import {
  billingWindow, windowCommitment, microsToUsd, type RequestAccounting,
} from "../../lib/collect/budget.ts";
import type {
  CollectionProvider, DatasetMetadata, DatasetPage, ProviderRead, ProviderRun, RunInputEvidence,
} from "../../lib/collect/provider.ts";

/**
 * C10 — cost reconciliation, against the real database and a scripted provider.
 *
 * The run this is built on: C01-B reported $0.0443 at the terminal moment and
 * $0.0998 for the same run later. So a terminal status settles nothing, the
 * first figure is not the final one, and the only way to a final figure is two
 * agreeing reads far enough apart.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const SETTINGS: Record<string, unknown> = {
  "collector.cost_settle_minutes": 15,
  "collector.cost_final_window_hours": 6,
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
    [`c10-${randomUUID()}@example.test`],
  );
  const { rows: category } = await client.query<{ id: string }>(
    "insert into public.categories (name) values ($1) returning id",
    [`C10 ${randomUUID().slice(0, 8)}`],
  );
  return { userId: user[0].id, categoryId: category[0].id };
}

/** The run's charge-bearing start; the cost window is measured from it. */
const STARTED_AT = new Date(Date.UTC(2026, 8, 11, 9, 9, 12, 548));
const now = (minutesAfterStart: number) => new Date(STARTED_AT.getTime() + minutesAfterStart * 60_000);

/** A request whose provider run is terminal: cost work is due, result work may be anything. */
async function costableRequest(
  client: pg.Client,
  base: { userId: string; categoryId: string },
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const columns: Record<string, unknown> = {
    requested_by: base.userId,
    request_key: randomUUID(),
    params: JSON.stringify({ keyword: "วิตามิน", country: "TH", active_status: "active", max_records: 300 }),
    category_id: base.categoryId,
    dataset_name: "วิตามิน · TH · 2026-09-11",
    source_url: "https://www.facebook.com/ads/library/?q=test",
    status: "settling",
    provider: "apify",
    provider_run_id: `RUN-${randomUUID()}`,
    provider_dataset_id: `DS-${randomUUID()}`,
    started_at: STARTED_AT.toISOString(),
    start_attempted_at: new Date(STARTED_AT.getTime() - 2_000).toISOString(),
    cost_status: "reserved",
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
  // The schedule the state machine writes when the provider run goes terminal.
  // With no identified run there is nothing to schedule — and the C04 invariant
  // refuses it anyway, which the test below proves.
  if (columns.provider_run_id !== null) {
    await client.query(
      "update public.collection_requests set cost_next_check_at = now() where id = $1",
      [rows[0].id],
    );
  }
  return rows[0].id;
}

async function costOf(client: pg.Client, id: string) {
  const { rows } = await client.query<{
    cost_status: string; cost_reserved_usd: string | null; cost_provisional_usd: string | null;
    cost_final_usd: string | null; cost_first_read_at: Date | null; cost_finalized_at: Date | null;
    cost_provisional_observed_at: Date | null; cost_next_check_at: Date | null;
    status: string; requires_admin: boolean; started_at: Date | null;
    start_attempted_at: Date | null;
  }>(
    `select cost_status, cost_reserved_usd, cost_provisional_usd, cost_final_usd, cost_first_read_at,
            cost_finalized_at, cost_provisional_observed_at, cost_next_check_at, status, requires_admin,
            started_at, start_attempted_at
       from public.collection_requests where id = $1`,
    [id],
  );
  return rows[0];
}

const auditActions = async (client: pg.Client, id: string) => {
  const { rows } = await client.query<{ action: string }>(
    "select action from public.audit_logs where entity_id = $1 order by created_at, id",
    [id],
  );
  return rows.map((row) => row.action);
};

/** Make the cost check due again, the way the sweep would. */
const costDue = (client: pg.Client, id: string) =>
  client.query("update public.collection_requests set cost_next_check_at = now() where id = $1", [id]);

// --- a provider that answers cost reads only -------------------------------------

type CostReading =
  | { usd?: string | null; chargedItems?: number | null; status?: ProviderRun["status"] }
  | "unavailable"
  | "malformed";

type ScriptedProvider = CollectionProvider & { readonly calls: string[] };

function costProvider(readings: CostReading[]): ScriptedProvider {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    async startRun(): Promise<never> {
      throw new Error("cost reconciliation never starts a provider run");
    },
    async readRun(runId: string): Promise<ProviderRead<ProviderRun>> {
      calls.push(`readRun:${runId}`);
      const reading = readings[Math.min(index, readings.length - 1)];
      index += 1;
      if (reading === "unavailable") return { ok: false, reason: "unavailable", detail: "http 503" };
      if (reading === "malformed") return { ok: false, reason: "malformed", detail: "unreadable body" };
      return {
        ok: true,
        value: {
          runId,
          status: reading.status ?? "SUCCEEDED",
          terminal: reading.status === undefined
            || ["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].includes(reading.status),
          succeeded: (reading.status ?? "SUCCEEDED") === "SUCCEEDED",
          datasetId: "DS-1", keyValueStoreId: "KV-1",
          startedAt: STARTED_AT.toISOString(), finishedAt: STARTED_AT.toISOString(),
          buildNumber: "2.7.25", ceilingUsd: "0.100000", maxItems: 133,
          usage: {
            reportedTotalUsd: reading.usd === undefined ? "0.0998" : reading.usd,
            chargedItems: reading.chargedItems ?? 133,
            chargedStartEvents: 1,
          },
        },
      };
    },
    async readRunInput(): Promise<ProviderRead<RunInputEvidence>> {
      return { ok: false, reason: "not_found", detail: "not scripted" };
    },
    async readDatasetMetadata(): Promise<ProviderRead<DatasetMetadata>> {
      calls.push("readDatasetMetadata");
      return { ok: false, reason: "not_found", detail: "cost work reads no dataset" };
    },
    async readDatasetItemTotal(): Promise<ProviderRead<number>> {
      calls.push("readDatasetItemTotal");
      return { ok: false, reason: "not_found", detail: "cost work reads no dataset" };
    },
    async readDatasetItems(): Promise<ProviderRead<DatasetPage>> {
      calls.push("readDatasetItems");
      return { ok: false, reason: "not_found", detail: "cost work reads no dataset" };
    },
    async findRunsSince(): Promise<ProviderRead<ProviderRun[]>> {
      calls.push("findRunsSince");
      return { ok: true, value: [] };
    },
  };
}

// --- provisional, and what it takes to become final ------------------------------

test("a provider figure becomes provisional, and only agreement makes it final", { skip }, async (t) => {
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

  await t.test("the first figure is provisional, never final", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.0443" }]);
    const outcome = await reconcileCost(id, { provider, now: now(1) });

    assert.equal(outcome.action, "observed");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_status, "provisional", "a terminal run is not a settled bill");
    assert.equal(cost.cost_provisional_usd, "0.044300");
    assert.equal(cost.cost_final_usd, null);
    assert.deepEqual(cost.cost_first_read_at, now(1));
    assert.deepEqual(cost.cost_provisional_observed_at, now(1));
    assert.ok(cost.cost_next_check_at, "and it is scheduled to be asked again");
    assert.deepEqual(await auditActions(client, id), ["collection.cost_observed"]);
  });

  await t.test("C01-B: the figure moves, and the first one is never finalized", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.0443" }, { usd: "0.0998" }, { usd: "0.0998" }]);

    await reconcileCost(id, { provider, now: now(1) });
    await costDue(client, id);
    // Twenty minutes later — past the settle interval, but the figure moved.
    const moved = await reconcileCost(id, { provider, now: now(21) });
    assert.equal(moved.action, "updated");
    const afterMove = await costOf(client, id);
    assert.equal(afterMove.cost_status, "provisional");
    assert.equal(afterMove.cost_provisional_usd, "0.099800");
    assert.equal(afterMove.cost_final_usd, null, "the earlier figure was never final");
    assert.deepEqual(afterMove.cost_first_read_at, now(1), "the first read ever stays where it was");
    assert.deepEqual(afterMove.cost_provisional_observed_at, now(21), "but the agreement clock restarts");

    // Agreement, far enough apart, is the only thing that finalizes.
    await costDue(client, id);
    const settled = await reconcileCost(id, { provider, now: now(40) });
    assert.equal(settled.action, "finalized");
    const final = await costOf(client, id);
    assert.equal(final.cost_status, "final");
    assert.equal(final.cost_final_usd, "0.099800");
    assert.deepEqual(final.cost_finalized_at, now(40));
    assert.equal(final.cost_next_check_at, null, "and nothing is asked again");
    assert.equal(final.cost_provisional_usd, "0.099800", "the evidence it settled from is kept");
    assert.deepEqual(await auditActions(client, id), [
      "collection.cost_observed", "collection.cost_updated", "collection.cost_finalized",
    ]);
  });

  await t.test("the same figure read too soon is the same read, not a second one", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.0998" }]);
    await reconcileCost(id, { provider, now: now(1) });
    await costDue(client, id);
    // Fourteen minutes: one short of the configured fifteen.
    const early = await reconcileCost(id, { provider, now: now(15) });
    assert.equal(early.action, "unchanged");
    assert.equal((await costOf(client, id)).cost_status, "provisional");

    await costDue(client, id);
    const late = await reconcileCost(id, { provider, now: now(17) });
    assert.equal(late.action, "finalized");
  });

  await t.test("a figure that agrees to the same money in another spelling still settles", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.0998" }, { usd: "0.09980" }]);
    await reconcileCost(id, { provider, now: now(1) });
    await costDue(client, id);
    const outcome = await reconcileCost(id, { provider, now: now(20) });
    assert.equal(outcome.action, "finalized");
    assert.equal((await costOf(client, id)).cost_final_usd, "0.099800");
  });

  await t.test("a figure that falls is evidence too", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.0998" }, { usd: "0.0500" }, { usd: "0.0500" }]);
    await reconcileCost(id, { provider, now: now(1) });
    await costDue(client, id);
    assert.equal((await reconcileCost(id, { provider, now: now(20) })).action, "updated");
    await costDue(client, id);
    assert.equal((await reconcileCost(id, { provider, now: now(40) })).action, "finalized");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_final_usd, "0.050000", "lower than the reservation, and still the truth");
    assert.equal(cost.cost_reserved_usd, "0.100000", "the historical reservation is not rewritten");
  });

  await t.test("a figure above the reservation is recorded as it is", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.1500" }]);
    await reconcileCost(id, { provider, now: now(1) });
    await costDue(client, id);
    assert.equal((await reconcileCost(id, { provider, now: now(20) })).action, "finalized");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_final_usd, "0.150000");
    assert.equal(cost.cost_reserved_usd, "0.100000");
  });

  await t.test("a settled cost is never asked about again", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.0998" }]);
    await reconcileCost(id, { provider, now: now(1) });
    await costDue(client, id);
    await reconcileCost(id, { provider, now: now(20) });
    const reads = provider.calls.length;

    await costDue(client, id);
    const again = await reconcileCost(id, { provider, now: now(60) });
    assert.equal(again.action, "not_due");
    assert.equal(provider.calls.length, reads, "no further provider read");
  });

  await t.test("unset cost settings read nothing and decide nothing", async () => {
    await setSettings(client, { "collector.cost_settle_minutes": null });
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.0998" }]);
    const outcome = await reconcileCost(id, { provider, now: now(1) });
    assert.equal(outcome.action, "not_configured");
    assert.equal(provider.calls.length, 0);
    assert.equal((await costOf(client, id)).cost_status, "reserved");
    await setSettings(client);
  });
});

// --- what cost work does not depend on -------------------------------------------

test("cost reconciliation does not stop for the collection's own troubles", { skip }, async (t) => {
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

  await t.test("a request waiting for an admin still settles its bill", async () => {
    const id = await costableRequest(client, base, {
      requires_admin: true, error_class: "provider_result_unsettled", next_check_at: null,
    });
    const provider = costProvider([{ usd: "0.0998" }]);
    const outcome = await reconcileCost(id, { provider, now: now(1) });
    assert.equal(outcome.action, "observed");
    const cost = await costOf(client, id);
    assert.equal(cost.requires_admin, true, "and it is still waiting for the admin");
    assert.equal(cost.cost_status, "provisional");
  });

  await t.test("an identity conflict does not stop the bill either", async () => {
    const id = await costableRequest(client, base, {
      requires_admin: true, error_class: "provider_identity_conflict", next_check_at: null,
    });
    assert.equal((await reconcileCost(id, { provider: costProvider([{ usd: "0.0443" }]), now: now(1) })).action, "observed");
  });

  await t.test("a failed collection still had a run, and the run still cost money", async () => {
    const id = await costableRequest(client, base, {
      status: "failed", error_class: "provider_run_failed", finished_at: now(2).toISOString(),
    });
    const provider = costProvider([{ usd: "0.0050" }, { usd: "0.0050" }]);
    assert.equal((await reconcileCost(id, { provider, now: now(3) })).action, "observed");
    await costDue(client, id);
    assert.equal((await reconcileCost(id, { provider, now: now(25) })).action, "finalized");
    const cost = await costOf(client, id);
    assert.equal(cost.status, "failed", "the collection is still failed");
    assert.equal(cost.cost_final_usd, "0.005000");
  });

  await t.test("a request with no identified run is never asked about", async () => {
    // provider_start_unknown: the run, if any, was never identified. The C04
    // invariant already forbids a cost schedule here.
    const id = await costableRequest(client, base, {
      status: "failed", provider_run_id: null, provider_dataset_id: null,
      error_class: "provider_start_unknown", cost_status: "unreported",
      finished_at: now(2).toISOString(),
    });
    const provider = costProvider([{ usd: "0.0998" }]);
    const outcome = await reconcileCost(id, { provider, now: now(3) });
    assert.equal(outcome.action, "not_due");
    assert.equal(provider.calls.length, 0, "no run is guessed at for the sake of a bill");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_status, "unreported");
    assert.equal(cost.cost_next_check_at, null);

    // And the database refuses to let anyone schedule one.
    await assert.rejects(
      client.query("update public.collection_requests set cost_next_check_at = now() where id = $1", [id]),
      /collection_requests_cost_check_needs_run/,
    );
  });
});

// --- the provider misbehaving ----------------------------------------------------

test("an unanswered question changes nothing", { skip }, async (t) => {
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

  await t.test("a 5xx leaves the figure alone and comes back later", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.0998" }, "unavailable"]);
    await reconcileCost(id, { provider, now: now(1) });
    await costDue(client, id);
    const outcome = await reconcileCost(id, { provider, now: now(20) });

    assert.equal(outcome.action, "provider_unavailable");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_provisional_usd, "0.099800", "the figure already held stands");
    assert.equal(cost.cost_status, "provisional");
    assert.equal(cost.cost_final_usd, null, "an outage never finalizes anything");
    assert.ok(cost.cost_next_check_at, "and it is asked again");
  });

  await t.test("an unreadable accounting shape is not a cost of zero", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: null }]);
    const outcome = await reconcileCost(id, { provider, now: now(1) });
    assert.equal(outcome.action, "no_amount");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_provisional_usd, null);
    assert.equal(cost.cost_status, "reserved", "nothing was observed, so nothing changed");
    assert.deepEqual(await auditActions(client, id), []);
  });

  await t.test("a figure in a shape nobody documented fails closed", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "about five cents" }]);
    assert.equal((await reconcileCost(id, { provider, now: now(1) })).action, "no_amount");
    assert.equal((await costOf(client, id)).cost_provisional_usd, null);
  });

  await t.test("charged events are never mistaken for the bill", async () => {
    // C01-B: 133 charged items while the reported total was still lagging.
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: null, chargedItems: 133 }]);
    assert.equal((await reconcileCost(id, { provider, now: now(1) })).action, "no_amount");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_provisional_usd, null, "an item count is not an amount");
    assert.equal(cost.cost_final_usd, null);
  });
});

// --- the window runs out ---------------------------------------------------------

test("the automatic cost window is bounded, and invents nothing when it ends", { skip }, async (t) => {
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

  await t.test("with a figure in hand: stop polling, stay provisional", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.0998" }]);
    await reconcileCost(id, { provider, now: now(1) });

    await costDue(client, id);
    // Seven hours after the run started, past the configured six.
    const outcome = await reconcileCost(id, { provider, now: now(7 * 60) });
    assert.equal(outcome.action, "window_exhausted_provisional");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_status, "provisional", "never promoted by a deadline");
    assert.equal(cost.cost_provisional_usd, "0.099800");
    assert.equal(cost.cost_final_usd, null);
    assert.equal(cost.cost_next_check_at, null);
    assert.deepEqual(await auditActions(client, id), [
      "collection.cost_observed", "collection.cost_window_exhausted",
    ]);
  });

  await t.test("with nothing ever reported: stop polling, unreported", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider(["unavailable"]);
    await reconcileCost(id, { provider, now: now(1) });

    await costDue(client, id);
    const outcome = await reconcileCost(id, { provider, now: now(7 * 60) });
    assert.equal(outcome.action, "window_exhausted_unreported");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_status, "unreported");
    assert.equal(cost.cost_final_usd, null, "no amount is invented at the deadline");
    assert.equal(cost.cost_next_check_at, null);
  });

  await t.test("an exhausted window is not polled again by an ordinary tick", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider(["unavailable"]);
    await reconcileCost(id, { provider, now: now(1) });
    await costDue(client, id);
    await reconcileCost(id, { provider, now: now(7 * 60) });
    const reads = provider.calls.length;

    const again = await reconcileCost(id, { provider, now: now(8 * 60) });
    assert.equal(again.action, "not_due");
    assert.equal(provider.calls.length, reads);
  });

  await t.test("the window is spent before a read, not after one", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.0998" }]);
    await reconcileCost(id, { provider, now: now(7 * 60) });
    assert.equal(provider.calls.length, 0, "an expired window spends no provider read");
  });
});

// --- concurrency -----------------------------------------------------------------

test("two workers racing one due cost read do the work once", { skip }, async (t) => {
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

  await t.test("ten rounds, one read each", async () => {
    for (let round = 0; round < 10; round += 1) {
      const id = await costableRequest(client, base);
      const first = costProvider([{ usd: "0.0998" }]);
      const second = costProvider([{ usd: "0.0998" }]);
      const [a, b] = await Promise.all([
        reconcileCost(id, { provider: first, now: now(1) }),
        reconcileCost(id, { provider: second, now: now(1) }),
      ]);
      const reads = first.calls.length + second.calls.length;
      assert.equal(reads, 1, `round ${round}: exactly one provider read`);
      assert.deepEqual([a.action, b.action].sort(), ["not_due", "observed"], `round ${round}`);
      assert.deepEqual(await auditActions(client, id), ["collection.cost_observed"], `round ${round}`);
    }
  });

  await t.test("a claimed tick is out of reach until its own lease is up", async () => {
    const id = await costableRequest(client, base);
    await reconcileCost(id, { provider: costProvider([{ usd: "0.0998" }]), now: now(1) });
    const scheduled = (await costOf(client, id)).cost_next_check_at;
    assert.ok(scheduled && scheduled.getTime() > Date.now(), "the next check is in the future");
    assert.ok(COST_CLAIM_SECONDS > 0);
  });
});

// --- only a terminal run has a bill ----------------------------------------------

test("a figure from a run still going is never evidence", { skip }, async (t) => {
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

  await t.test("RUNNING reports an amount, and nothing is recorded", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([{ usd: "0.0443", status: "RUNNING" }]);
    const outcome = await reconcileCost(id, { provider, now: now(1) });

    assert.equal(outcome.action, "not_terminal");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_provisional_usd, null, "a number in flight is not a provisional cost");
    assert.equal(cost.cost_provisional_observed_at, null, "and it starts no agreement clock");
    assert.equal(cost.cost_status, "reserved");
    assert.ok(cost.cost_next_check_at, "it is simply asked again");
    assert.deepEqual(await auditActions(client, id), []);
  });

  await t.test("a status nobody documented never finalizes anything", async () => {
    const id = await costableRequest(client, base);
    // Terminal agreement first, then the provider answers with something unknown.
    const provider = costProvider([
      { usd: "0.0998" },
      { usd: "0.0998", status: "UNKNOWN" },
      { usd: "0.0998", status: "UNKNOWN" },
    ]);
    await reconcileCost(id, { provider, now: now(1) });
    await costDue(client, id);
    const later = await reconcileCost(id, { provider, now: now(30) });
    assert.equal(later.action, "not_terminal", "an UNKNOWN status cannot settle a bill");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_status, "provisional");
    assert.equal(cost.cost_final_usd, null);
    assert.deepEqual(cost.cost_provisional_observed_at, now(1), "and the agreement clock did not move");
  });

  await t.test("the same figure, agreed on terminal readings, still settles", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([
      { usd: "0.0998" },
      { usd: "0.0998", status: "RUNNING" },
      { usd: "0.0998" },
    ]);
    await reconcileCost(id, { provider, now: now(1) });
    await costDue(client, id);
    assert.equal((await reconcileCost(id, { provider, now: now(20) })).action, "not_terminal");
    await costDue(client, id);
    const settled = await reconcileCost(id, { provider, now: now(40) });
    assert.equal(settled.action, "finalized");
    assert.equal((await costOf(client, id)).cost_final_usd, "0.099800");
  });

  await t.test("C01-B, step by step, and final only at the last step", async () => {
    const id = await costableRequest(client, base);
    const provider = costProvider([
      { usd: "0.0443" },   // terminal, the figure the run finished with
      { usd: "0.0998" },   // terminal, and the provider has caught up
      { usd: "0.0998" },   // the same, but too soon to agree
      { usd: "0.0998" },   // the same, far enough apart
    ]);

    assert.equal((await reconcileCost(id, { provider, now: now(1) })).action, "observed");
    assert.equal((await costOf(client, id)).cost_final_usd, null);

    await costDue(client, id);
    assert.equal((await reconcileCost(id, { provider, now: now(20) })).action, "updated");
    assert.equal((await costOf(client, id)).cost_final_usd, null);

    await costDue(client, id);
    assert.equal((await reconcileCost(id, { provider, now: now(30) })).action, "unchanged");
    assert.equal((await costOf(client, id)).cost_final_usd, null, "ten minutes is not fifteen");

    await costDue(client, id);
    assert.equal((await reconcileCost(id, { provider, now: now(40) })).action, "finalized");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_final_usd, "0.099800");
    assert.equal(cost.cost_status, "final");
  });
});

// --- the window anchor -----------------------------------------------------------

test("the cost window is measured from the charge, not from the paperwork", { skip }, async (t) => {
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

  await t.test("a request queued long before it ran keeps its full window", async () => {
    const id = await costableRequest(client, base);
    // Created three days before the run started: an anchor on creation would
    // have expired this window before the first read.
    await client.query(
      "update public.collection_requests set created_at = $2 where id = $1",
      [id, new Date(STARTED_AT.getTime() - 3 * 24 * 3_600_000).toISOString()],
    );
    const outcome = await reconcileCost(id, { provider: costProvider([{ usd: "0.0998" }]), now: now(1) });
    assert.equal(outcome.action, "observed", "the window runs from the run, not from the request");
    assert.ok((await costOf(client, id)).cost_next_check_at);
  });

  await t.test("no provider start: the recorded start attempt bounds the polling only", async () => {
    const id = await costableRequest(client, base, { started_at: null });
    const cost = await costOf(client, id);
    assert.equal(cost.started_at, null);
    assert.ok(cost.start_attempted_at);

    // Inside the window, measured from the attempt.
    assert.equal((await reconcileCost(id, { provider: costProvider([{ usd: "0.0998" }]), now: now(60) })).action, "observed");

    // And past it, the deadline still applies.
    await costDue(client, id);
    const expired = await reconcileCost(id, { provider: costProvider([{ usd: "0.0998" }]), now: now(7 * 60) });
    assert.equal(expired.action, "window_exhausted_provisional");
    assert.equal((await costOf(client, id)).cost_status, "provisional");
  });

  await t.test("a cost with no start of its own is still not attributable to a cycle", () => {
    // The polling deadline used the start attempt; the accounting may not. C05
    // fails closed rather than attributing a real charge by a convenient time.
    const window = billingWindow("2026-09-01", 1, new Date("2026-09-11T12:00:00Z"));
    assert.ok(window);
    const noStart: RequestAccounting = {
      status: "failed", cost_status: "final",
      cost_reserved_usd: "0.100000", cost_provisional_usd: "0.099800", cost_final_usd: "0.099800",
      reservation_released_at: null, started_at: null,
    };
    const commitment = windowCommitment([noStart], window);
    assert.equal(commitment.ok, false);
    assert.equal(commitment.ok === false ? commitment.reason : null, "unattributable_final_cost");
  });

  await t.test("neither timestamp: stop rather than poll without a deadline", async () => {
    const id = await costableRequest(client, base, { started_at: null, start_attempted_at: null });
    const provider = costProvider([{ usd: "0.0998" }]);
    const outcome = await reconcileCost(id, { provider, now: now(1) });

    assert.equal(outcome.action, "no_window_anchor");
    assert.equal(provider.calls.length, 0, "and no read is spent on an unbounded window");
    const cost = await costOf(client, id);
    assert.equal(cost.cost_status, "unreported", "nothing was ever observed for this run");
    assert.equal(cost.cost_final_usd, null, "and no timestamp or amount is invented");
    assert.equal(cost.cost_next_check_at, null);
  });
});

// --- what the budget makes of it -------------------------------------------------

test("a final cost replaces the reservation instead of adding to it", { skip: false }, () => {
  const window = billingWindow("2026-09-01", 1, new Date("2026-09-11T12:00:00Z"));
  assert.ok(window);
  const request: RequestAccounting = {
    status: "succeeded", cost_status: "final",
    cost_reserved_usd: "0.100000", cost_provisional_usd: "0.099800", cost_final_usd: "0.099800",
    reservation_released_at: null, started_at: STARTED_AT.toISOString(),
  };
  const commitment = windowCommitment([request], window);
  assert.ok(commitment.ok);
  assert.equal(microsToUsd(commitment.commitment.finalizedActualCostMicros), "0.099800");
  assert.equal(commitment.commitment.heldReservationMicros, 0n, "the reservation is not counted a second time");

  // While it is still provisional, the larger of the two is held and nothing is
  // reported as an actual cost.
  const stillMoving: RequestAccounting = { ...request, cost_status: "provisional", cost_final_usd: null };
  const held = windowCommitment([stillMoving], window);
  assert.ok(held.ok);
  assert.equal(held.commitment.finalizedActualCostMicros, 0n);
  assert.equal(microsToUsd(held.commitment.heldReservationMicros), "0.100000");
});

// --- boundaries ------------------------------------------------------------------

test("cost reconciliation stays a read path, and stays out of sight", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  t.after(async () => {
    await client.query("delete from public.collection_requests");
    await client.end();
    await closePool();
  });

  await t.test("the module can only read", () => {
    const source = readFileSync("lib/collect/cost.ts", "utf8");
    assert.doesNotMatch(source, /startRun|POST|provider\.read(Dataset|RunInput)/);
    assert.equal(source.match(/provider\.readRun\(/g)?.length, 1, "one provider call, and it is a read");
    // No secret, header or provider host is written by this module.
    assert.doesNotMatch(source, /APIFY_TOKEN|Authorization|Bearer|api\.apify/);
    // Provider text is scrubbed before it can reach a column.
    assert.match(source, /scrubProviderMessage/);
    // The budget meaning of an amount belongs to C05, not here.
    assert.doesNotMatch(source, /windowCommitment|assessBudget|availableBudget/);
  });

  await t.test("an ordinary signed-in role cannot read any of it", async () => {
    await costableRequest(client, base);
    for (const column of [
      "cost_reserved_usd", "cost_provisional_usd", "cost_final_usd", "cost_finalized_at",
      "cost_next_check_at", "cost_provisional_observed_at", "provider_run_id",
    ]) {
      const { rows } = await client.query<{ allowed: boolean }>(
        "select has_column_privilege('authenticated', 'public.collection_requests', $1, 'SELECT') as allowed",
        [column],
      );
      assert.equal(rows[0].allowed, false, `${column} must stay admin-only`);
    }
    // And the requester's own status view carries none of it either.
    const { rows: viewColumns } = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'collection_request_status'",
    );
    const names = viewColumns.map((row) => row.column_name);
    for (const column of ["cost_reserved_usd", "cost_provisional_usd", "cost_final_usd", "provider_run_id"]) {
      assert.ok(!names.includes(column), `${column} must not appear in the user-facing view`);
    }
  });
});
