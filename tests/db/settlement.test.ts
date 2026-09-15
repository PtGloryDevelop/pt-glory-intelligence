import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type pg from "pg";
import { connect, createAuthUser } from "./helpers.ts";
import { advance } from "../../lib/collect/machine.ts";
import { closePool } from "../../lib/db/privileged.ts";
import { commitImport } from "../../lib/import/commit.ts";
import { analyzeImport } from "../../lib/import/analyze.ts";
import { adaptApifyItems } from "../../lib/collect/adapter.ts";
import type {
  CollectionProvider, DatasetMetadata, DatasetPage, ProviderRead, ProviderRun, RunInputEvidence,
} from "../../lib/collect/provider.ts";

/**
 * C09 — the settlement gate and the canonical import, against the real database.
 *
 * The two facts every case here defends: nothing incomplete is ever recorded as
 * a complete collection, and one request produces at most one canonical run no
 * matter how the workers fall over.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const SOURCE_URL = "https://www.facebook.com/ads/library/?q=test&search_type=keyword_unordered";
/** The modified time a settled dataset carries throughout this suite. */
const SETTLED_AT = "2026-09-11T09:09:30.000Z";

const SETTINGS: Record<string, unknown> = {
  "collector.actor_build": "2.7.25",
  "collector.run_timeout_minutes": 10,
  "collector.lease_seconds": 120,
  "collector.reconcile_window_minutes": 30,
  "collector.reconcile_page_size": 20,
  "collector.result_settle_seconds": 30,
  "collector.result_settle_window_minutes": 15,
  "collector.max_export_bytes": 25_000_000,
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
  const userId = await createAuthUser(client, `c09-${randomUUID()}@example.test`);
  const { rows: category } = await client.query<{ id: string }>(
    "insert into public.categories (name) values ($1) returning id",
    [`C09 ${randomUUID().slice(0, 8)}`],
  );
  return { userId, categoryId: category[0].id };
}

/** A request as C08 leaves it: the provider run finished successfully. */
async function settlingRequest(
  client: pg.Client,
  base: { userId: string; categoryId: string },
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const columns: Record<string, unknown> = {
    requested_by: base.userId,
    request_key: randomUUID(),
    params: JSON.stringify({ keyword: "วิตามิน", country: "TH", active_status: "active", max_records: 300 }),
    category_id: base.categoryId,
    // Admission names the dataset before the provider is ever contacted (C07).
    dataset_name: "วิตามิน · TH · 2026-09-11",
    source_url: SOURCE_URL,
    cost_reserved_usd: "0.100000",
    status: "settling",
    provider: "apify",
    provider_run_id: `RUN-${randomUUID()}`,
    provider_dataset_id: `DS-${randomUUID()}`,
    started_at: "2026-09-11T09:09:12.548Z",
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

async function stateOf(client: pg.Client, id: string) {
  const { rows } = await client.query<{
    status: string; requires_admin: boolean; error_class: string | null; error_detail: string | null;
    result_item_count: number | null; result_modified_at: Date | null; result_pagination_total: number | null;
    result_observed_at: Date | null; result_settle_started_at: Date | null; next_check_at: Date | null;
    collection_run_id: string | null; dataset_id: string | null; result: Record<string, number> | null;
    provider_item_count: number | null; stop_reason: string | null; finished_at: Date | null;
    media_enqueued_at: Date | null; import_attempted_at: Date | null; lease_owner: string | null;
  }>(
    `select status, requires_admin, error_class, error_detail, result_item_count, result_modified_at,
            result_pagination_total, result_observed_at, result_settle_started_at, next_check_at,
            collection_run_id, dataset_id, result, provider_item_count, stop_reason, finished_at,
            media_enqueued_at, import_attempted_at, lease_owner
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

/** Ready the row for the next tick the way the scheduler would. */
const due = (client: pg.Client, id: string) =>
  client.query("update public.collection_requests set next_check_at = now() where id = $1", [id]);

// --- a provider that answers from a script of dataset readings ------------------

type Reading = { itemCount: number; modifiedAt?: string | null; total?: number | null };

type ScriptedProvider = CollectionProvider & { readonly calls: string[] };

/**
 * One reading per metadata+pagination pair, then the last reading repeats. A
 * settle tick reads one pair; an import tick reads one before the fetch and one
 * after it, which is what the final fence is. `total: null` scripts a provider
 * whose pagination header is missing — the case that must never be read as
 * "no items".
 */
function datasetProvider(readings: Reading[], items: unknown[] = []): ScriptedProvider {
  const calls: string[] = [];
  let index = 0;
  const current = () => readings[Math.min(index, readings.length - 1)];
  return {
    calls,
    async startRun(): Promise<never> {
      throw new Error("C09 never starts a provider run");
    },
    async readRun(): Promise<ProviderRead<ProviderRun>> {
      calls.push("readRun");
      return { ok: false, reason: "unavailable", detail: "not scripted" };
    },
    async readRunInput(): Promise<ProviderRead<RunInputEvidence>> {
      return { ok: false, reason: "not_found", detail: "not scripted" };
    },
    async readDatasetMetadata(): Promise<ProviderRead<DatasetMetadata>> {
      calls.push("readDatasetMetadata");
      const reading = current();
      return {
        ok: true,
        value: {
          itemCount: reading.itemCount,
          modifiedAt: reading.modifiedAt === undefined ? SETTLED_AT : reading.modifiedAt,
        },
      };
    },
    async readDatasetItemTotal(): Promise<ProviderRead<number>> {
      calls.push("readDatasetItemTotal");
      const reading = current();
      index += 1; // one metadata+pagination pair consumed
      const total = reading.total === undefined ? reading.itemCount : reading.total;
      return total === null
        ? { ok: false, reason: "malformed", detail: "no pagination total" }
        : { ok: true, value: total };
    },
    async readDatasetItems(_id: string, page): Promise<ProviderRead<DatasetPage>> {
      calls.push(`readDatasetItems#${page.offset}+${page.limit}`);
      return {
        ok: true,
        value: { items: items.slice(page.offset, page.offset + page.limit), total: items.length },
      };
    },
    async findRunsSince(): Promise<ProviderRead<ProviderRun[]>> {
      return { ok: true, value: [] };
    },
  };
}

/** A provider item shaped like the real export, with a forbidden metric attached. */
const apifyItem = (n: number) => ({
  ad_archive_id: `90000000000${String(n).padStart(4, "0")}`,
  page_id: `70000000${String(n % 7).padStart(3, "0")}`,
  page_name: `เพจทดสอบ ${n % 7}`,
  is_active: true,
  start_date: 1_757_000_000 + n,
  end_date: 1_757_900_000 + n,
  publisher_platform: ["FACEBOOK", "INSTAGRAM"],
  // Never canonical, whatever the provider ships: C02 drops these by allowlist.
  spend: { lower_bound: "0", upper_bound: "99" },
  impressions_with_index: { impressions_text: "1K-5K" },
  total_active_time: 12_345,
  snapshot: {
    display_format: "VIDEO",
    page_like_count: 1_000 + n,
    page_categories: ["Health/beauty"],
    cta_type: "MESSAGE_PAGE",
    title: `หัวข้อ ${n}`,
    body: { text: `เนื้อหาโฆษณา ${n}` },
    videos: [{ video_hd_url: `https://example.test/v${n}.mp4`, video_preview_image_url: null }],
  },
});

const items = (count: number) => Array.from({ length: count }, (_, i) => apifyItem(i + 1));

const now = (offsetSeconds: number) => new Date(Date.UTC(2026, 8, 11, 10, 0, 0) + offsetSeconds * 1000);

// --- settlement gate ------------------------------------------------------------

test("the settlement gate never lets a moving dataset become a complete collection", { skip }, async (t) => {
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

  await t.test("one reading records an observation and stays settling", async () => {
    const id = await settlingRequest(client, base);
    const provider = datasetProvider([{ itemCount: 133, modifiedAt: SETTLED_AT }]);
    const outcome = await advance(id, { provider, worker: "w1", now: now(0) });

    assert.equal(outcome.action, "result_observed");
    const state = await stateOf(client, id);
    assert.equal(state.status, "settling");
    assert.equal(state.result_item_count, 133);
    assert.equal(state.result_pagination_total, 133);
    assert.ok(state.result_observed_at, "the observation is persisted, not held in memory");
    assert.ok(state.result_settle_started_at, "and the window starts counting");
    assert.equal(state.collection_run_id, null, "nothing is imported on one reading");
    assert.equal(state.lease_owner, null, "the lease is released");
  });

  await t.test("a second reading of the same moment is not a second observation", async () => {
    const id = await settlingRequest(client, base);
    const provider = datasetProvider([
      { itemCount: 133, modifiedAt: SETTLED_AT },
      { itemCount: 133, modifiedAt: SETTLED_AT },
    ]);
    await advance(id, { provider, worker: "w1", now: now(0) });
    await due(client, id);
    // Five seconds later, well inside the configured thirty.
    const outcome = await advance(id, { provider, worker: "w1", now: now(5) });
    assert.equal(outcome.action, "result_observed");
    assert.equal((await stateOf(client, id)).status, "settling");
  });

  await t.test("an unchanged pair, far enough apart, opens the import", async () => {
    const id = await settlingRequest(client, base);
    const provider = datasetProvider([
      { itemCount: 133, modifiedAt: SETTLED_AT },
      { itemCount: 133, modifiedAt: SETTLED_AT },
    ]);
    await advance(id, { provider, worker: "w1", now: now(0) });
    await due(client, id);
    const outcome = await advance(id, { provider, worker: "w1", now: now(40) });

    assert.equal(outcome.action, "result_ready");
    const state = await stateOf(client, id);
    assert.equal(state.status, "importing");
    assert.ok(state.import_attempted_at, "the import attempt is marked before any import happens");
    assert.deepEqual(await auditActions(client, id), ["collection.result_ready"]);
  });

  await t.test("C01-B: 117 then 133 never imports 117", async () => {
    const id = await settlingRequest(client, base);
    const provider = datasetProvider([
      // What the provider said about a second after the run finished.
      { itemCount: 117, modifiedAt: SETTLED_AT },
      // What the dataset actually holds.
      { itemCount: 133, modifiedAt: "2026-09-11T09:09:38.000Z" },
      { itemCount: 133, modifiedAt: "2026-09-11T09:09:38.000Z" },
    ]);

    await advance(id, { provider, worker: "w1", now: now(0) });
    assert.equal((await stateOf(client, id)).result_item_count, 117);

    await due(client, id);
    const moved = await advance(id, { provider, worker: "w1", now: now(40) });
    assert.equal(moved.action, "result_observed", "the result moved, so it is not ready");
    const afterMove = await stateOf(client, id);
    assert.equal(afterMove.status, "settling");
    assert.equal(afterMove.result_item_count, 133, "the baseline becomes what was last actually seen");
    assert.equal(afterMove.collection_run_id, null, "and 117 ads were never recorded as the collection");

    await due(client, id);
    const ready = await advance(id, { provider, worker: "w1", now: now(80) });
    assert.equal(ready.action, "result_ready");
    assert.equal((await stateOf(client, id)).result_item_count, 133);
  });

  await t.test("a dataset modified between observations is still moving", async () => {
    const id = await settlingRequest(client, base);
    const provider = datasetProvider([
      { itemCount: 133, modifiedAt: SETTLED_AT },
      { itemCount: 133, modifiedAt: "2026-09-11T09:09:44.000Z" },
    ]);
    await advance(id, { provider, worker: "w1", now: now(0) });
    await due(client, id);
    const outcome = await advance(id, { provider, worker: "w1", now: now(40) });
    assert.equal(outcome.action, "result_observed");
    assert.equal((await stateOf(client, id)).status, "settling");
  });

  await t.test("a pagination total that disagrees with the count is never ready", async () => {
    const id = await settlingRequest(client, base);
    const provider = datasetProvider([
      { itemCount: 133, total: 133, modifiedAt: SETTLED_AT },
      { itemCount: 133, total: 130, modifiedAt: SETTLED_AT },
    ]);
    await advance(id, { provider, worker: "w1", now: now(0) });
    await due(client, id);
    const outcome = await advance(id, { provider, worker: "w1", now: now(40) });
    assert.equal(outcome.action, "result_observed");
    assert.match(outcome.detail ?? "", /pagination total 130 disagrees/);
    assert.equal((await stateOf(client, id)).status, "settling");
  });

  await t.test("a missing pagination header is unreadable, never zero items", async () => {
    const id = await settlingRequest(client, base);
    const provider = datasetProvider([{ itemCount: 133, total: null, modifiedAt: SETTLED_AT }]);
    const outcome = await advance(id, { provider, worker: "w1", now: now(0) });
    assert.equal(outcome.action, "result_observed");
    const state = await stateOf(client, id);
    assert.equal(state.status, "settling");
    assert.equal(state.result_item_count, null, "an unreadable tick records no observation at all");
  });

  await t.test("unset settlement settings import nothing and invent no interval", async () => {
    await setSettings(client, { "collector.result_settle_seconds": null });
    const id = await settlingRequest(client, base);
    const provider = datasetProvider([{ itemCount: 133 }]);
    const outcome = await advance(id, { provider, worker: "w1", now: now(0) });
    assert.equal(outcome.action, "not_configured");
    assert.equal(provider.calls.length, 0, "and the provider is not even read");
    assert.equal((await stateOf(client, id)).status, "settling");
    await setSettings(client);
  });
});

// --- settlement timeout ---------------------------------------------------------

test("a result that will not settle is handed to a person, not imported", { skip }, async (t) => {
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

  await t.test("past the window: requires_admin, provider_result_unsettled, polling stops", async () => {
    const id = await settlingRequest(client, base, {
      result_settle_started_at: now(0).toISOString(),
      result_item_count: 117, result_pagination_total: 117,
      result_modified_at: SETTLED_AT,
      result_observed_at: now(0).toISOString(),
    });
    const provider = datasetProvider([{ itemCount: 130, modifiedAt: "2026-09-11T09:10:30.000Z" }]);
    // Sixteen minutes later, past the configured fifteen.
    const outcome = await advance(id, { provider, worker: "w1", now: now(16 * 60) });

    assert.equal(outcome.action, "result_unsettled");
    const state = await stateOf(client, id);
    assert.equal(state.status, "settling", "the state is preserved, not failed");
    assert.equal(state.requires_admin, true);
    assert.equal(state.error_class, "provider_result_unsettled");
    assert.equal(state.next_check_at, null, "automatic settlement polling stops");
    assert.equal(state.collection_run_id, null, "and nothing partial was imported");
    assert.deepEqual(await auditActions(client, id), ["collection.requires_admin"]);
  });

  await t.test("and the next tick does not pick it up again", async () => {
    const id = await settlingRequest(client, base, {
      requires_admin: true, error_class: "provider_result_unsettled", next_check_at: null,
    });
    const provider = datasetProvider([{ itemCount: 133 }]);
    const outcome = await advance(id, { provider, worker: "w2", now: now(20 * 60) });
    assert.equal(outcome.action, "not_claimed");
    assert.equal(provider.calls.length, 0);
  });

  await t.test("a terminal run naming no dataset asks a person immediately", async () => {
    const id = await settlingRequest(client, base, { provider_dataset_id: null });
    const provider = datasetProvider([{ itemCount: 133 }]);
    const outcome = await advance(id, { provider, worker: "w1", now: now(0) });
    assert.equal(outcome.action, "result_unsettled");
    const state = await stateOf(client, id);
    assert.equal(state.requires_admin, true);
    assert.equal(state.error_class, "provider_result_unsettled");
  });

  await t.test("the settle window is measured from the first tick, not renewed by observing", async () => {
    const id = await settlingRequest(client, base);
    const provider = datasetProvider([
      { itemCount: 100 }, { itemCount: 101 }, { itemCount: 102 },
    ]);
    await advance(id, { provider, worker: "w1", now: now(0) });
    const first = (await stateOf(client, id)).result_settle_started_at;
    await due(client, id);
    await advance(id, { provider, worker: "w1", now: now(60) });
    assert.deepEqual((await stateOf(client, id)).result_settle_started_at, first);
  });
});

// --- the import -----------------------------------------------------------------

test("a settled result imports once, through the canonical engine", { skip }, async (t) => {
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

  const readyToImport = async (overrides: Record<string, unknown> = {}) => settlingRequest(client, base, {
    status: "importing",
    import_attempted_at: new Date().toISOString(),
    result_item_count: 12, result_pagination_total: 12,
    result_modified_at: SETTLED_AT,
    result_observed_at: now(0).toISOString(),
    result_settle_started_at: now(0).toISOString(),
    ...overrides,
  });

  await t.test("the settled items become one canonical run, owned by the requester", async () => {
    const id = await readyToImport();
    const provider = datasetProvider([{ itemCount: 12 }], items(12));
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });

    assert.equal(outcome.action, "imported");
    const state = await stateOf(client, id);
    assert.equal(state.status, "succeeded");
    assert.ok(state.collection_run_id);
    assert.ok(state.dataset_id);
    assert.equal(state.provider_item_count, 12);
    assert.deepEqual(state.result, { ads: 12, pages: 7, unresolved: 0, quarantined: 0 });
    assert.ok(state.finished_at);

    const { rows } = await client.query<{
      created_by: string; scope_country: string; collection_method: string; stop_reason: string | null;
      dataset_by: string; request_link: string;
    }>(
      `select run.created_by, run.scope_country, run.collection_method, run.stop_reason,
              dataset.created_by as dataset_by,
              run.reported_quality_summary ->> 'collection_request_id' as request_link
         from public.collection_runs run
         join public.datasets dataset on dataset.collection_run_id = run.id
        where run.id = $1`,
      [state.collection_run_id],
    );
    const run = rows[0];
    assert.equal(run.created_by, base.userId, "the requester owns the run, never the worker");
    assert.equal(run.dataset_by, base.userId);
    assert.equal(run.scope_country, "TH", "country comes from the request scope");
    assert.equal(run.collection_method, "apify_actor_run");
    assert.equal(run.request_link, id, "the request id rides in the quality summary, which is what the index protects");
    assert.equal(run.stop_reason, null, "twelve ads under a cap of 300 proves nothing about exhaustion");
  });

  await t.test("the dataset carries exactly the name admission persisted", async () => {
    const id = await readyToImport({ dataset_name: "Campaign A" });
    const provider = datasetProvider([{ itemCount: 12 }], items(12));
    assert.equal((await advance(id, { provider, worker: "w1", now: now(100) })).action, "imported");

    const { rows } = await client.query<{ name: string }>(
      "select name from public.datasets where id = $1", [(await stateOf(client, id)).dataset_id],
    );
    assert.equal(rows[0].name, "Campaign A", "used verbatim: the import neither tidies nor renames");
  });

  await t.test("a request with no persisted name fails closed rather than inventing one", async () => {
    const id = await readyToImport({ dataset_name: "   " });
    const provider = datasetProvider([{ itemCount: 12 }], items(12));
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });
    assert.equal(outcome.action, "import_failed");
    const state = await stateOf(client, id);
    assert.equal(state.error_class, "adapter_rejected");
    assert.equal(state.collection_run_id, null);
  });

  await t.test("no forbidden metric survives the adapter, and an active ad keeps no end date", async () => {
    const id = await readyToImport();
    const provider = datasetProvider([{ itemCount: 12 }], items(12));
    await advance(id, { provider, worker: "w1", now: now(100) });
    const runId = (await stateOf(client, id)).collection_run_id;

    const { rows: observations } = await client.query<{ n: string }>(
      "select count(*)::text as n from public.ad_observations where collection_run_id = $1",
      [runId],
    );
    assert.equal(Number(observations[0].n), 12);

    const { rows: summary } = await client.query<{ names: string[] }>(
      `select coalesce(reported_quality_summary -> 'forbidden_key_names', '[]'::jsonb) as names
         from public.collection_runs where id = $1`,
      [runId],
    );
    // Seen and named as diagnostics; never carried as a value.
    assert.ok((summary[0].names as unknown as string[]).includes("spend"));
    const { rows: ends } = await client.query<{ with_end: string; raw: string }>(
      `select count(ad.end_date)::text as with_end, count(obs.network_end_date_raw)::text as raw
         from public.ad_observations obs
         join public.ads ad on ad.id = obs.ad_ref
        where obs.collection_run_id = $1`,
      [runId],
    );
    assert.equal(Number(ends[0].with_end), 0, "every ad is active, so no end date is invented");
    assert.equal(Number(ends[0].raw), 12, "the provider's own end date survives only as raw provenance");
  });

  await t.test("the record cap bounds the import, and says so as limit_reached", async () => {
    const id = await readyToImport({
      params: JSON.stringify({ keyword: "วิตามิน", country: "TH", active_status: "active", max_records: 5 }),
      result_item_count: 12, result_pagination_total: 12,
    });
    const provider = datasetProvider([{ itemCount: 12 }], items(12));
    await advance(id, { provider, worker: "w1", now: now(100) });

    const state = await stateOf(client, id);
    assert.equal(state.result?.ads, 5, "only the authorized number of records is imported");
    assert.equal(state.stop_reason, "limit_reached");
    assert.ok(provider.calls.includes("readDatasetItems#0+5"), "and only that range is fetched");
  });

  await t.test("a short fetch writes nothing and starts the observations again", async () => {
    const id = await readyToImport({ result_item_count: 12, result_pagination_total: 12 });
    // The dataset said twelve, then handed back eight.
    const provider = datasetProvider([{ itemCount: 12 }], items(8));
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });

    assert.equal(outcome.action, "import_incomplete");
    const state = await stateOf(client, id);
    assert.equal(state.status, "settling", "back to the gate");
    assert.equal(state.result_item_count, null, "with no baseline, so the next reading is a first observation");
    assert.equal(state.collection_run_id, null);
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from public.collection_runs
        where reported_quality_summary ->> 'collection_request_id' = $1`, [id],
    );
    assert.equal(rows[0].n, "0", "and nothing at all was written");
  });

  await t.test("an export over the byte cap fails closed and writes nothing", async () => {
    await setSettings(client, { "collector.max_export_bytes": 500 });
    const id = await readyToImport();
    const provider = datasetProvider([{ itemCount: 12 }], items(12));
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });

    assert.equal(outcome.action, "import_failed");
    const state = await stateOf(client, id);
    assert.equal(state.status, "failed");
    assert.equal(state.error_class, "export_too_large");
    assert.equal(state.collection_run_id, null);
    await setSettings(client);
  });

  await t.test("an unset byte cap imports nothing and moves nothing", async () => {
    await setSettings(client, { "collector.max_export_bytes": null });
    const id = await readyToImport();
    const provider = datasetProvider([{ itemCount: 12 }], items(12));
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });
    assert.equal(outcome.action, "not_configured");
    assert.equal((await stateOf(client, id)).status, "importing");
    await setSettings(client);
  });

  await t.test("a row the validator would reject becomes an unresolved row, not a weakened ad", async () => {
    const id = await readyToImport({ result_item_count: 7, result_pagination_total: 7 });
    const rows: unknown[] = items(5);
    // No page id: a row the validator would reject, kept as evidence instead of
    // being let through as an ad with a hole in it.
    rows.push({ ...apifyItem(98), page_id: null });
    // No ad id at all: unresolved by the frozen count definition.
    rows.push({ ...apifyItem(99), ad_archive_id: null });
    const provider = datasetProvider([{ itemCount: 7 }], rows);
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });

    assert.equal(outcome.action, "imported");
    const state = await stateOf(client, id);
    assert.equal(state.result?.ads, 5, "only whole ads become ads");
    assert.equal(state.result?.unresolved, 1, "a row with no ad id is unresolved, by the frozen definition");
    assert.equal(state.result?.quarantined, 2, "both incomplete rows are quarantined, never weakened into ads");
    const { rows: summary } = await client.query<{ reasons: Record<string, number> }>(
      `select reported_quality_summary -> 'unresolved_reasons' as reasons
         from public.collection_runs where id = $1`,
      [state.collection_run_id],
    );
    assert.deepEqual(summary[0].reasons, { missing_page_id: 1, missing_ad_archive_id: 1 });
  });

  await t.test("billing evidence never gates the import", async () => {
    // The charged events said 117 while the dataset holds 12. That is C10's
    // problem, and it is not allowed to stop a settled result being imported.
    const id = await readyToImport({ result_charged_items: 117 });
    const provider = datasetProvider([{ itemCount: 12 }], items(12));
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });
    assert.equal(outcome.action, "imported");
  });
});

// --- exactly once ---------------------------------------------------------------

test("one request produces one canonical run, whatever the workers do", { skip }, async (t) => {
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

  const runsFor = async (id: string) => {
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from public.collection_runs
        where reported_quality_summary ->> 'collection_request_id' = $1`, [id],
    );
    return Number(rows[0].n);
  };

  const readyToImport = async (overrides: Record<string, unknown> = {}) => settlingRequest(client, base, {
    status: "importing",
    import_attempted_at: new Date().toISOString(),
    result_item_count: 10, result_pagination_total: 10,
    result_modified_at: SETTLED_AT,
    result_observed_at: now(0).toISOString(),
    result_settle_started_at: now(0).toISOString(),
    ...overrides,
  });

  await t.test("two workers racing one importing request commit once", async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = await readyToImport();
      const [a, b] = await Promise.all([
        advance(id, { provider: datasetProvider([{ itemCount: 10 }], items(10)), worker: "w1", now: now(100) }),
        advance(id, { provider: datasetProvider([{ itemCount: 10 }], items(10)), worker: "w2", now: now(100) }),
      ]);
      assert.equal(await runsFor(id), 1, `round ${round}: exactly one canonical run`);
      const actions = [a.action, b.action].sort();
      assert.deepEqual(actions, ["imported", "not_claimed"], `round ${round}: one imported, one was kept out`);
    }
  });

  await t.test("a crash after the commit is recovered by adoption, not by importing again", async () => {
    const id = await readyToImport();
    await advance(id, { provider: datasetProvider([{ itemCount: 10 }], items(10)), worker: "w1", now: now(100) });
    const committed = await stateOf(client, id);
    assert.equal(await runsFor(id), 1);

    // The commit landed; the worker died before the request was linked to it.
    await client.query(
      `update public.collection_requests
          set status = 'importing', collection_run_id = null, dataset_id = null, result = null,
              finished_at = null, media_enqueued_at = null, next_check_at = now()
        where id = $1`, [id],
    );

    const outcome = await advance(id, {
      provider: datasetProvider([{ itemCount: 10 }], items(10)), worker: "w2", now: now(200),
    });
    assert.equal(outcome.action, "import_adopted");
    assert.equal(await runsFor(id), 1, "the existing run is adopted, never duplicated");
    const state = await stateOf(client, id);
    assert.equal(state.status, "succeeded");
    assert.equal(state.collection_run_id, committed.collection_run_id);
    assert.equal(state.dataset_id, committed.dataset_id);
  });

  await t.test("the database refuses a second canonical commit for the same request", async () => {
    const id = await readyToImport();
    const exported = adaptApifyItems({
      items: items(4), collectionRequestId: id,
      scope: { country: "TH", query: "วิตามิน", activeStatus: "active" },
      sourceUrl: SOURCE_URL, maxRecords: 300, maxExportBytes: 25_000_000,
      generatedAt: now(0).toISOString(),
      stop: { runSucceeded: true, ceilingReached: false, guardStopped: false, exhaustionEvidence: false },
    });
    assert.ok(exported.ok);
    const analysis = analyzeImport(exported.text);
    assert.ok(analysis.ok);
    const input = {
      canonical: analysis.canonical, categoryId: base.categoryId,
      datasetName: `direct ${randomUUID().slice(0, 8)}`, actorId: base.userId,
    };

    await commitImport(input);
    await assert.rejects(
      commitImport(input),
      (error: { code?: string; constraint?: string }) =>
        error.code === "23505" && error.constraint === "collection_runs_request_once",
      "the unique index is the final barrier, not a hope",
    );
    assert.equal(await runsFor(id), 1);
  });

  await t.test("advancing a finished request again imports nothing", async () => {
    const id = await readyToImport();
    await advance(id, { provider: datasetProvider([{ itemCount: 10 }], items(10)), worker: "w1", now: now(100) });
    await due(client, id);
    // The media step, then nothing more.
    await advance(id, { provider: datasetProvider([{ itemCount: 10 }], items(10)), worker: "w1", now: now(120) });
    await due(client, id);
    const again = await advance(id, {
      provider: datasetProvider([{ itemCount: 10 }], items(10)), worker: "w1", now: now(140),
    });
    assert.equal(again.action, "not_claimed");
    assert.equal(await runsFor(id), 1);
  });
});

// --- after the commit -----------------------------------------------------------

test("the media enqueue is a separate step that never repeats the import", { skip }, async (t) => {
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

  await t.test("the enqueue happens after the commit, and only once", async () => {
    const id = await settlingRequest(client, base, {
      status: "importing", import_attempted_at: new Date().toISOString(),
      result_item_count: 6, result_pagination_total: 6,
      result_modified_at: SETTLED_AT, result_observed_at: now(0).toISOString(),
      result_settle_started_at: now(0).toISOString(),
    });
    await advance(id, { provider: datasetProvider([{ itemCount: 6 }], items(6)), worker: "w1", now: now(100) });

    const afterCommit = await stateOf(client, id);
    assert.equal(afterCommit.status, "succeeded");
    assert.equal(afterCommit.media_enqueued_at, null, "the commit does not wait on the queue");
    assert.ok(afterCommit.next_check_at, "and the step it still owes is scheduled");

    await due(client, id);
    const queued = await advance(id, {
      provider: datasetProvider([{ itemCount: 6 }], items(6)), worker: "w1", now: now(120),
    });
    assert.equal(queued.action, "media_enqueued");
    const settled = await stateOf(client, id);
    assert.ok(settled.media_enqueued_at);
    assert.equal(settled.next_check_at, null);

    const queuedRows = async () => {
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n
           from public.media_assets asset
           join public.ad_observations obs on obs.id = asset.ad_observation_id
          where obs.collection_run_id = $1`,
        [afterCommit.collection_run_id],
      );
      return Number(rows[0].n);
    };
    assert.equal(await queuedRows(), 6, "one queued row per observation");

    // A second pass adds nothing: the request is no longer claimable, and the
    // enqueue itself only ever inserts where nothing exists.
    await client.query("update public.collection_requests set next_check_at = now() where id = $1", [id]);
    const again = await advance(id, {
      provider: datasetProvider([{ itemCount: 6 }], items(6)), worker: "w1", now: now(140),
    });
    assert.equal(again.action, "not_claimed");
    assert.equal(await queuedRows(), 6);
  });

  await t.test("audit records each step once", async () => {
    const id = await settlingRequest(client, base, {
      status: "importing", import_attempted_at: new Date().toISOString(),
      result_item_count: 3, result_pagination_total: 3,
      result_modified_at: SETTLED_AT, result_observed_at: now(0).toISOString(),
      result_settle_started_at: now(0).toISOString(),
    });
    await advance(id, { provider: datasetProvider([{ itemCount: 3 }], items(3)), worker: "w1", now: now(100) });
    await due(client, id);
    await advance(id, { provider: datasetProvider([{ itemCount: 3 }], items(3)), worker: "w1", now: now(120) });
    assert.deepEqual(await auditActions(client, id), ["collection.imported", "collection.media_enqueued"]);
  });
});

// --- zero result ----------------------------------------------------------------

test("a successful run with no ads is a finished collection, not a dataset", { skip }, async (t) => {
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

  await t.test("zero items: no dataset, no canonical run, and the evidence is kept", async () => {
    const id = await settlingRequest(client, base);
    const provider = datasetProvider([{ itemCount: 0 }, { itemCount: 0 }], []);
    await advance(id, { provider, worker: "w1", now: now(0) });
    await due(client, id);
    await advance(id, { provider, worker: "w1", now: now(40) });
    assert.equal((await stateOf(client, id)).status, "importing");
    await due(client, id);
    const outcome = await advance(id, { provider, worker: "w1", now: now(80) });

    assert.equal(outcome.action, "zero_result");
    const state = await stateOf(client, id);
    assert.equal(state.status, "succeeded");
    assert.equal(state.dataset_id, null, "an empty dataset would be a collection that never happened");
    assert.equal(state.collection_run_id, null);
    assert.deepEqual(state.result, { ads: 0, pages: 0, unresolved: 0, quarantined: 0 });
    assert.equal(state.provider_item_count, 0);
    assert.ok(state.finished_at);
    assert.ok(state.media_enqueued_at, "nothing was committed, so nothing is owed downstream");
    assert.deepEqual(await auditActions(client, id), ["collection.result_ready", "collection.zero_result"]);

    const { rows } = await client.query<{ n: string }>(
      "select count(*)::text as n from public.datasets where category_id = $1 and name like '%วิตามิน%'",
      [base.categoryId],
    );
    assert.equal(rows[0].n, "0");
  });
});

// --- the final fence ------------------------------------------------------------

test("a dataset that changes after it settled is never committed", { skip }, async (t) => {
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

  const windowStart = now(-300).toISOString();
  const readyToImport = async (overrides: Record<string, unknown> = {}) => settlingRequest(client, base, {
    status: "importing",
    import_attempted_at: new Date().toISOString(),
    result_item_count: 12, result_pagination_total: 12,
    result_modified_at: SETTLED_AT,
    result_observed_at: now(0).toISOString(),
    result_settle_started_at: windowStart,
    ...overrides,
  });

  const runsFor = async (id: string) => {
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from public.collection_runs
        where reported_quality_summary ->> 'collection_request_id' = $1`, [id],
    );
    return Number(rows[0].n);
  };

  await t.test("changed before the fetch: nothing is read, nothing is written", async () => {
    const id = await readyToImport();
    // Between the last settlement observation and this tick, the dataset grew.
    const provider = datasetProvider([{ itemCount: 15 }], items(15));
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });

    assert.equal(outcome.action, "import_incomplete");
    assert.equal(await runsFor(id), 0, "no canonical run");
    assert.ok(!provider.calls.some((call) => call.startsWith("readDatasetItems")),
      "and the items were never even fetched");

    const state = await stateOf(client, id);
    assert.equal(state.status, "settling");
    assert.equal(state.result_item_count, 15, "the new evidence becomes the baseline");
    assert.deepEqual(state.result_settle_started_at, new Date(windowStart),
      "and the settlement window keeps running rather than restarting");
    assert.deepEqual(await auditActions(client, id), ["collection.result_changed"]);
  });

  await t.test("and two fresh stable observations are needed before it may import again", async () => {
    const id = await readyToImport();
    const provider = datasetProvider([{ itemCount: 15 }], items(15));
    await advance(id, { provider, worker: "w1", now: now(100) });

    await due(client, id);
    // One reading agreeing with the new baseline is not yet two observations
    // taken far enough apart.
    const tooSoon = await advance(id, { provider, worker: "w1", now: now(110) });
    assert.equal(tooSoon.action, "result_observed");
    assert.equal((await stateOf(client, id)).status, "settling");

    await due(client, id);
    const ready = await advance(id, { provider, worker: "w1", now: now(150) });
    assert.equal(ready.action, "result_ready");
    assert.equal((await stateOf(client, id)).status, "importing");
  });

  await t.test("changed while the items were being read: fetched, then thrown away", async () => {
    const id = await readyToImport();
    // The reading before the fetch matches the baseline; the one after it does not.
    const provider = datasetProvider([{ itemCount: 12 }, { itemCount: 14 }], items(12));
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });

    assert.equal(outcome.action, "import_incomplete");
    assert.ok(provider.calls.some((call) => call.startsWith("readDatasetItems")),
      "the fetch did happen, which is exactly why the second check exists");
    assert.equal(await runsFor(id), 0, "and none of it was committed");

    const state = await stateOf(client, id);
    assert.equal(state.status, "settling");
    assert.equal(state.result_item_count, 14);
    assert.deepEqual(state.result_settle_started_at, new Date(windowStart));
    assert.deepEqual(await auditActions(client, id), ["collection.result_changed"]);
  });

  await t.test("an unreadable check is not proof that nothing changed", async () => {
    const id = await readyToImport();
    const provider = datasetProvider([{ itemCount: 12, total: null }], items(12));
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });

    assert.equal(outcome.action, "import_incomplete");
    assert.equal(await runsFor(id), 0);
    const state = await stateOf(client, id);
    assert.equal(state.status, "settling");
    assert.equal(state.result_item_count, 12, "with no evidence of change, the baseline stands");
    assert.deepEqual(await auditActions(client, id), [], "and nothing is announced as a change");
  });

  await t.test("zero is re-checked too: a dataset that filled in is not a zero result", async () => {
    const id = await readyToImport({ result_item_count: 0, result_pagination_total: 0 });
    const provider = datasetProvider([{ itemCount: 9 }], items(9));
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });

    assert.equal(outcome.action, "import_incomplete");
    const state = await stateOf(client, id);
    assert.equal(state.status, "settling", "never succeeded on a count that had already moved");
    assert.equal(state.result_item_count, 9);
    assert.equal(state.finished_at, null);
  });

  await t.test("a zero result still zero at the completion tick succeeds", async () => {
    const id = await readyToImport({ result_item_count: 0, result_pagination_total: 0 });
    const provider = datasetProvider([{ itemCount: 0 }], []);
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });
    assert.equal(outcome.action, "zero_result");
    assert.equal((await stateOf(client, id)).status, "succeeded");
  });
});

// --- transport paging -----------------------------------------------------------

test("a dataset larger than one provider page is read whole, exactly once", { skip }, async (t) => {
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

  await t.test("1,001 items arrive in two pages, with nothing lost and nothing repeated", async () => {
    const id = await settlingRequest(client, base, {
      status: "importing",
      import_attempted_at: new Date().toISOString(),
      params: JSON.stringify({ keyword: "วิตามิน", country: "TH", active_status: "active", max_records: 2_000 }),
      result_item_count: 1_001, result_pagination_total: 1_001,
      result_modified_at: SETTLED_AT, result_observed_at: now(0).toISOString(),
      result_settle_started_at: now(0).toISOString(),
    });
    const provider = datasetProvider([{ itemCount: 1_001 }], items(1_001));
    const outcome = await advance(id, { provider, worker: "w1", now: now(100) });

    assert.equal(outcome.action, "imported");
    // The page size is a transport detail, not a cap: two pages, no overlap.
    assert.deepEqual(
      provider.calls.filter((call) => call.startsWith("readDatasetItems")),
      ["readDatasetItems#0+1000", "readDatasetItems#1000+1"],
    );

    const state = await stateOf(client, id);
    assert.equal(state.result?.ads, 1_001, "every item became an ad");
    assert.equal(state.provider_item_count, 1_001);
    assert.equal(state.stop_reason, null, "1,001 under a cap of 2,000 says nothing about exhaustion");

    const { rows } = await client.query<{ n: string; distinct: string }>(
      `select count(*)::text as n, count(distinct ad_ref)::text as distinct
         from public.ad_observations where collection_run_id = $1`,
      [state.collection_run_id],
    );
    assert.equal(rows[0].n, "1001");
    assert.equal(rows[0].distinct, "1001", "no item was imported twice");
  });
});

// --- the machine's own boundaries -----------------------------------------------

test("the import path stays server-side and provider-neutral", { skip: false }, () => {
  const source = readFileSync("lib/collect/machine.ts", "utf8");
  // previewImport needs a signed-in person's session. The background path uses
  // the same validation underneath, through analyzeImport.
  assert.doesNotMatch(source, /previewImport\(/);
  assert.match(source, /analyzeImport/);
  assert.match(source, /commitImport/);
  // The requester owns what was collected for them.
  assert.match(source, /actorId: request\.requested_by/);
  // One commit call, in one place.
  assert.equal(source.match(/await commitImport\(/g)?.length, 1);
  // The dataset name is admission's, used exactly as persisted. Naming a result
  // at import time would give a retry a different name from its first attempt.
  assert.match(source, /datasetName: request\.dataset_name,/);
  assert.doesNotMatch(source, /autoDatasetName|defaultDatasetName/);
  // Nothing commits without both ends of the fence.
  assert.equal(source.match(/await verifyUnchanged\(/g)?.length, 3);
  // No secret, header or provider host is written by this module.
  assert.doesNotMatch(source, /APIFY_TOKEN|Authorization|Bearer|api\.apify/);
});
