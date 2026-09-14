import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { connect } from "./helpers.ts";
import { admitCollection, type AdmissionInput } from "../../lib/collect/admission.ts";
import { closePool } from "../../lib/db/privileged.ts";

/**
 * C07 — admission, against the real database and the real advisory lock.
 *
 * The races below use two independent connections and the same code path the
 * product uses. Nothing is mocked: a lock that only works in a single process
 * would prove nothing about two server instances.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const NOW = new Date("2026-09-20T00:00:00Z");

/** Settings a working collector needs. Every test starts from these. */
const WORKING_SETTINGS: Record<string, unknown> = {
  "collector.enabled": true,
  "collector.monthly_budget_usd": 10,
  "collector.max_charge_per_run_usd": 0.5,
  "collector.billing_cycle_anchor": "2026-09-05",
  "collector.billing_cycle_length_months": 1,
  "collector.max_records_per_run": 3000,
  "collector.max_concurrent": 1,
  "collector.actor_build": "2.7.25",
  "collector.countries": ["TH"],
};

async function setSettings(client: pg.Client, overrides: Record<string, unknown> = {}) {
  const values = { ...WORKING_SETTINGS, ...overrides };
  for (const [key, value] of Object.entries(values)) {
    await client.query(
      `insert into public.app_settings (key, value) values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }
}

/**
 * These suites rewrite collector settings, and the C04 suite asserts the values
 * the migration seeded. So each suite puts them back exactly as it found them.
 */
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
    [`c07-${randomUUID()}@example.test`],
  );
  const { rows: category } = await client.query<{ id: string }>(
    "insert into public.categories (name) values ($1) returning id",
    [`C07 ${randomUUID().slice(0, 8)}`],
  );
  return { userId: user[0].id, categoryId: category[0].id };
}

/** Every route file under app/, for the entry-point scan. */
function walkRoutes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkRoutes(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Admission always starts from an empty ledger, so each case owns its state. */
async function reset(client: pg.Client) {
  await client.query("delete from public.collection_requests");
}

const request = (base: { userId: string; categoryId: string }, overrides: Partial<AdmissionInput> = {}): AdmissionInput => ({
  requestedBy: base.userId,
  requestKey: randomUUID(),
  keyword: "วิตามินสลายไขมัน",
  country: "TH",
  activeStatus: "active",
  maxRecords: 300,
  categoryId: base.categoryId,
  datasetName: "C07 dataset",
  ...overrides,
});

/** A request already in the ledger, so the next admission has something to weigh. */
async function seedRequest(client: pg.Client, userId: string, categoryId: string, row: Record<string, unknown>) {
  const columns = ["requested_by", "request_key", "params", "category_id", ...Object.keys(row)];
  const values = [userId, randomUUID(), JSON.stringify({ keyword: "x", country: "TH", active_status: "active", max_records: 10 }), categoryId, ...Object.values(row)];
  const placeholders = columns.map((_, i) => (i === 2 ? `$${i + 1}::jsonb` : `$${i + 1}`));
  await client.query(
    `insert into public.collection_requests (${columns.join(", ")}) values (${placeholders.join(", ")})`,
    values,
  );
}

test("admission judges settings, budget and concurrency in one place", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  const restoreSettings = await snapshotSettings(client);
  t.after(async () => {
    await reset(client);
    await restoreSettings();
    await client.end();
    await closePool();
  });

  await t.test("a disabled collector admits nothing", async () => {
    await reset(client);
    await setSettings(client, { "collector.enabled": false });
    const result = await admitCollection(request(base), { now: NOW });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.refusal, "not_configured");
    const { rows } = await client.query("select 1 from public.collection_requests");
    assert.equal(rows.length, 0, "nothing is queued and nothing is reserved");
  });

  await t.test("a required setting left unset admits nothing", async () => {
    for (const key of [
      "collector.monthly_budget_usd", "collector.max_charge_per_run_usd",
      "collector.billing_cycle_anchor", "collector.billing_cycle_length_months",
      "collector.max_records_per_run", "collector.actor_build", "collector.max_concurrent",
    ]) {
      await reset(client);
      await setSettings(client, { [key]: null });
      const result = await admitCollection(request(base), { now: NOW });
      assert.equal(result.ok, false, key);
      if (!result.ok) assert.equal(result.refusal, "not_configured", key);
      const { rows } = await client.query("select 1 from public.collection_requests");
      assert.equal(rows.length, 0, key);
    }
  });

  await t.test("an empty ledger admits at the configured per-run ceiling", async () => {
    await reset(client);
    await setSettings(client);
    const result = await admitCollection(request(base), { now: NOW });
    assert.ok(result.ok);
    assert.equal(result.reused, false);
    assert.equal(result.reservedUsd, "0.500000", "the per-run ceiling, since the budget is larger");

    const { rows } = await client.query<{ status: string; cost_status: string; cost_reserved_usd: string; source_url: string }>(
      "select status, cost_status, cost_reserved_usd, source_url from public.collection_requests",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "queued");
    assert.equal(rows[0].cost_status, "reserved");
    assert.equal(rows[0].cost_reserved_usd, "0.500000");
    assert.match(rows[0].source_url, /^https:\/\/www\.facebook\.com\/ads\/library\//);

    const audit = await client.query("select 1 from public.audit_logs where action = 'collection.start'");
    assert.ok((audit.rowCount ?? 0) >= 1, "the admission is audited");
  });

  await t.test("a settled cost in this cycle reduces what is left", async () => {
    await reset(client);
    await setSettings(client);
    await seedRequest(client, base.userId, base.categoryId, {
      status: "succeeded", finished_at: NOW.toISOString(),
      cost_status: "final", cost_final_usd: "9.800000",
      started_at: "2026-09-10T00:00:00Z",
    });
    const result = await admitCollection(request(base), { now: NOW });
    assert.ok(result.ok);
    assert.equal(result.reservedUsd, "0.200000", "remaining budget, below the per-run ceiling");
  });

  await t.test("a settled cost that started in the previous cycle does not", async () => {
    await reset(client);
    await setSettings(client);
    await seedRequest(client, base.userId, base.categoryId, {
      status: "succeeded", finished_at: NOW.toISOString(),
      cost_status: "final", cost_final_usd: "9.800000",
      // Before the 2026-09-05 anchor: another cycle's charge.
      started_at: "2026-08-20T00:00:00Z",
    });
    const result = await admitCollection(request(base), { now: NOW });
    assert.ok(result.ok);
    assert.equal(result.reservedUsd, "0.500000");
  });

  await t.test("an older reservation still held is still counted", async () => {
    await reset(client);
    await setSettings(client);
    await seedRequest(client, base.userId, base.categoryId, {
      // Queued long before this cycle, never finalized: the money is still held.
      status: "failed", finished_at: "2026-08-01T00:00:00Z",
      cost_status: "unreported", cost_reserved_usd: "9.800000",
      error_class: "provider_start_unknown",
    });
    const result = await admitCollection(request(base), { now: NOW });
    assert.ok(result.ok);
    assert.equal(result.reservedUsd, "0.200000", "an unknown start keeps holding across cycles");
  });

  await t.test("a released reservation frees its budget again", async () => {
    await reset(client);
    await setSettings(client);
    await seedRequest(client, base.userId, base.categoryId, {
      status: "failed", finished_at: "2026-08-01T00:00:00Z",
      cost_status: "unreported", cost_reserved_usd: "9.800000",
      error_class: "provider_start_unknown",
      reservation_released_at: NOW.toISOString(), reservation_released_by: base.userId,
      reservation_release_reason: "no run found after review",
    });
    const result = await admitCollection(request(base), { now: NOW });
    assert.ok(result.ok);
    assert.equal(result.reservedUsd, "0.500000");
  });

  await t.test("the exact budget boundary is refused, and one unit below is admitted", async () => {
    await reset(client);
    await setSettings(client);
    await seedRequest(client, base.userId, base.categoryId, {
      status: "succeeded", finished_at: NOW.toISOString(),
      cost_status: "final", cost_final_usd: "10.000000", started_at: "2026-09-10T00:00:00Z",
    });
    const spent = await admitCollection(request(base), { now: NOW });
    assert.equal(spent.ok, false);
    if (!spent.ok) assert.equal(spent.refusal, "budget_reached");

    await reset(client);
    await seedRequest(client, base.userId, base.categoryId, {
      status: "succeeded", finished_at: NOW.toISOString(),
      cost_status: "final", cost_final_usd: "9.999999", started_at: "2026-09-10T00:00:00Z",
    });
    const sliver = await admitCollection(request(base), { now: NOW });
    assert.ok(sliver.ok);
    assert.equal(sliver.reservedUsd, "0.000001");
  });

  await t.test("a live request fills the configured slot", async () => {
    await reset(client);
    await setSettings(client);
    await seedRequest(client, base.userId, base.categoryId, {
      status: "running", provider_run_id: randomUUID(), started_at: NOW.toISOString(),
    });
    const busy = await admitCollection(request(base), { now: NOW });
    assert.equal(busy.ok, false);
    if (!busy.ok) assert.equal(busy.refusal, "busy");

    // The limit is a setting, not a constant.
    await setSettings(client, { "collector.max_concurrent": 2 });
    const admitted = await admitCollection(request(base), { now: NOW });
    assert.ok(admitted.ok);
  });

  await t.test("the request itself is validated before anything is held", async () => {
    await reset(client);
    await setSettings(client);
    const cases: [string, Partial<AdmissionInput>][] = [
      ["an empty keyword", { keyword: "   " }],
      ["a country nobody collects", { country: "US" }],
      ["a record count above the configured cap", { maxRecords: 3_001 }],
      ["a record count below one", { maxRecords: 0 }],
      ["an unknown category", { categoryId: randomUUID() }],
      ["no request key", { requestKey: "  " }],
    ];
    for (const [name, overrides] of cases) {
      const result = await admitCollection(request(base, overrides), { now: NOW });
      assert.equal(result.ok, false, name);
      if (!result.ok) assert.equal(result.refusal, "invalid_request", name);
    }
    const { rows } = await client.query("select 1 from public.collection_requests");
    assert.equal(rows.length, 0, "no reservation was created by a rejected request");
  });

  await t.test("the same submission twice is the same request", async () => {
    await reset(client);
    await setSettings(client);
    const submission = request(base);
    const first = await admitCollection(submission, { now: NOW });
    const second = await admitCollection(submission, { now: NOW });
    assert.ok(first.ok && second.ok);
    assert.equal(second.requestId, first.requestId);
    assert.equal(second.reused, true, "a browser retry is not a second reservation");
    const { rows } = await client.query("select 1 from public.collection_requests");
    assert.equal(rows.length, 1);
    const audit = await client.query(
      "select 1 from public.audit_logs where action = 'collection.start' and entity_id = $1",
      [first.requestId],
    );
    assert.equal(audit.rowCount, 1, "and not a second collection.start either");
  });

  await t.test("a key that carries a different collection is refused, not reused", async () => {
    await reset(client);
    await setSettings(client);
    const submission = request(base);
    const first = await admitCollection(submission, { now: NOW });
    assert.ok(first.ok);

    const changed: [string, Partial<AdmissionInput>][] = [
      ["a different keyword", { keyword: "คอลลาเจน" }],
      ["a different record count", { maxRecords: 500 }],
      ["a different status", { activeStatus: "all" }],
      ["a different category", { categoryId: (await fixtures(client)).categoryId }],
    ];
    for (const [name, overrides] of changed) {
      const result = await admitCollection({ ...submission, ...overrides }, { now: NOW });
      assert.equal(result.ok, false, name);
      if (!result.ok) {
        assert.equal(result.refusal, "invalid_request", name);
        assert.match(result.detail, /different collection/, name);
      }
    }
    // A label on the result is not the collection: the same paid request with a
    // renamed dataset is still the same request.
    const renamed = await admitCollection({ ...submission, datasetName: "another name" }, { now: NOW });
    assert.ok(renamed.ok);
    assert.equal(renamed.reused, true);

    const { rows } = await client.query("select 1 from public.collection_requests");
    assert.equal(rows.length, 1, "nothing was admitted a second time");
  });

  await t.test("changing only the country is a different collection", async () => {
    await reset(client);
    // Both countries are collectable, so the refusal can only come from the
    // idempotency rule rather than from plain input validation.
    await setSettings(client, { "collector.countries": ["TH", "VN"] });
    const submission = request(base);
    const first = await admitCollection(submission, { now: NOW });
    assert.ok(first.ok);

    const elsewhere = await admitCollection({ ...submission, country: "VN" }, { now: NOW });
    assert.equal(elsewhere.ok, false, "a different country is a different paid collection");
    if (!elsewhere.ok) {
      assert.equal(elsewhere.refusal, "invalid_request");
      assert.match(elsewhere.detail, /different collection/);
      assert.ok(!("requestId" in elsewhere), "and no request is handed back");
    }

    const { rows } = await client.query<{ id: string; params: { country: string }; cost_reserved_usd: string }>(
      "select id, params, cost_reserved_usd from public.collection_requests",
    );
    assert.equal(rows.length, 1, "no second request");
    assert.equal(rows[0].params.country, "TH", "and the original is untouched");
    assert.equal(rows[0].cost_reserved_usd, first.reservedUsd, "no second reservation");
    const audit = await client.query(
      "select 1 from public.audit_logs where action = 'collection.start' and entity_id = $1",
      [first.requestId],
    );
    assert.equal(audit.rowCount, 1, "and no second collection.start");
  });

  await t.test("an unnamed collection is named at admission, before anything starts", async () => {
    await reset(client);
    await setSettings(client);
    // 2026-09-20T00:00Z is already the 20th of September in Bangkok (UTC+7).
    const admitted = await admitCollection(request(base, { datasetName: null }), { now: NOW });
    assert.ok(admitted.ok);

    const { rows } = await client.query<{ dataset_name: string; status: string; start_attempted_at: string | null }>(
      "select dataset_name, status, start_attempted_at from public.collection_requests where id = $1",
      [admitted.requestId],
    );
    assert.equal(rows[0].dataset_name, "วิตามินสลายไขมัน · TH · 2026-09-20",
      "keyword, country and the admission date in Bangkok");
    assert.equal(rows[0].status, "queued");
    assert.equal(rows[0].start_attempted_at, null, "and the name exists before any provider is contacted");
  });

  await t.test("the Bangkok date is the requester's day, not UTC's", async () => {
    await reset(client);
    await setSettings(client);
    // 18:30Z on the 19th is already 01:30 on the 20th in Bangkok.
    const admitted = await admitCollection(
      request(base, { datasetName: null }), { now: new Date("2026-09-19T18:30:00Z") });
    assert.ok(admitted.ok);
    const { rows } = await client.query<{ dataset_name: string }>(
      "select dataset_name from public.collection_requests where id = $1", [admitted.requestId],
    );
    assert.match(rows[0].dataset_name, /2026-09-20$/);
  });

  await t.test("a blank name is a name to generate, not a name to keep", async () => {
    await reset(client);
    await setSettings(client);
    const admitted = await admitCollection(request(base, { datasetName: "   " }), { now: NOW });
    assert.ok(admitted.ok);
    const { rows } = await client.query<{ dataset_name: string }>(
      "select dataset_name from public.collection_requests where id = $1", [admitted.requestId],
    );
    assert.equal(rows[0].dataset_name, "วิตามินสลายไขมัน · TH · 2026-09-20");
  });

  await t.test("a label added to an auto-named request never rewrites it", async () => {
    await reset(client);
    await setSettings(client);
    const submission = request(base, { datasetName: null });
    const first = await admitCollection(submission, { now: NOW });
    assert.ok(first.ok);

    const relabelled = await admitCollection({ ...submission, datasetName: "my own label" }, { now: NOW });
    assert.ok(relabelled.ok);
    assert.equal(relabelled.requestId, first.requestId);
    assert.equal(relabelled.reused, true);

    const { rows } = await client.query<{ dataset_name: string }>(
      "select dataset_name from public.collection_requests where id = $1", [first.requestId],
    );
    assert.equal(rows[0].dataset_name, "วิตามินสลายไขมัน · TH · 2026-09-20",
      "the name the request was admitted with stands");
  });

  await t.test("a padded name is stored the way it will be read", async () => {
    await reset(client);
    await setSettings(client);
    const submission = request(base, { datasetName: "  Campaign A  " });
    const admitted = await admitCollection(submission, { now: NOW });
    assert.ok(admitted.ok);

    const nameOf = async () => {
      const { rows } = await client.query<{ dataset_name: string }>(
        "select dataset_name from public.collection_requests where id = $1", [admitted.requestId],
      );
      return rows[0].dataset_name;
    };
    assert.equal(await nameOf(), "Campaign A", "normalized once, at admission, and never again");

    // The same submission with a different label is the same request.
    const again = await admitCollection({ ...submission, datasetName: "Campaign B" }, { now: NOW });
    assert.ok(again.ok);
    assert.equal(again.requestId, admitted.requestId);
    assert.equal(again.reused, true);
    assert.equal(await nameOf(), "Campaign A", "and a later label never rewrites it");
  });

  await t.test("a renamed dataset reuses the request without renaming it", async () => {
    await reset(client);
    await setSettings(client);
    const submission = request(base, { datasetName: "the name it was admitted with" });
    const first = await admitCollection(submission, { now: NOW });
    assert.ok(first.ok);

    const renamed = await admitCollection(
      { ...submission, datasetName: "a different label" }, { now: NOW });
    assert.ok(renamed.ok);
    assert.equal(renamed.requestId, first.requestId);
    assert.equal(renamed.reused, true);

    const { rows } = await client.query<{ dataset_name: string }>(
      "select dataset_name from public.collection_requests",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dataset_name, "the name it was admitted with",
      "presentation metadata never rewrites an admitted request");
    const audit = await client.query(
      "select 1 from public.audit_logs where action = 'collection.start' and entity_id = $1",
      [first.requestId],
    );
    assert.equal(audit.rowCount, 1);
  });

  await t.test("somebody else's key is refused without revealing the request", async () => {
    await reset(client);
    await setSettings(client);
    const submission = request(base);
    const mine = await admitCollection(submission, { now: NOW });
    assert.ok(mine.ok);

    const other = await fixtures(client);
    const result = await admitCollection(
      { ...submission, requestedBy: other.userId }, { now: NOW });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.refusal, "invalid_request");
      assert.doesNotMatch(JSON.stringify(result), new RegExp(mine.requestId),
        "the other person's request id must not leak");
      assert.doesNotMatch(result.detail, /already used for a different/,
        "and it says nothing about whose it is");
    }
    const { rows } = await client.query("select 1 from public.collection_requests");
    assert.equal(rows.length, 1, "no second request, no second reservation");
  });

  await t.test("a failure inside the transaction leaves nothing behind", async () => {
    await reset(client);
    await setSettings(client);
    // A requester that does not exist: the insert violates its foreign key
    // after the lock, the settings read and the whole evaluation.
    const ghost = randomUUID();
    await assert.rejects(
      admitCollection(request(base, { requestedBy: ghost }), { now: NOW }),
      /violates foreign key|insert or update/i,
    );
    const { rows } = await client.query("select 1 from public.collection_requests");
    assert.equal(rows.length, 0, "no partial request survives");
    // Scoped to this attempt: earlier cases in this suite audited real admissions.
    const audit = await client.query(
      "select 1 from public.audit_logs where action = 'collection.start' and actor = $1", [ghost],
    );
    assert.equal(audit.rowCount, 0, "and no audit row claims this collection started");
  });
});

test("two admissions at the same time cannot both win", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  const restoreSettings = await snapshotSettings(client);
  t.after(async () => {
    await reset(client);
    await restoreSettings();
    await client.end();
    await closePool();
  });

  await t.test("a budget with room for one admits exactly one, ten times over", async () => {
    for (let round = 0; round < 10; round += 1) {
      await reset(client);
      // Room for exactly one run at the per-run ceiling.
      await setSettings(client, { "collector.monthly_budget_usd": 0.5, "collector.max_concurrent": 5 });

      const [a, b] = await Promise.all([
        admitCollection(request(base), { now: NOW }),
        admitCollection(request(base), { now: NOW }),
      ]);
      const admitted = [a, b].filter((r) => r.ok);
      const refused = [a, b].filter((r) => !r.ok);
      assert.equal(admitted.length, 1, `round ${round}: exactly one admitted`);
      assert.equal(refused.length, 1, `round ${round}: exactly one refused`);
      assert.equal(refused[0].ok === false && refused[0].refusal, "budget_reached", `round ${round}`);

      const { rows } = await client.query<{ n: string }>(
        "select count(*)::text as n from public.collection_requests",
      );
      assert.equal(rows[0].n, "1", `round ${round}: only one reservation persists`);
    }
  });

  await t.test("one slot admits exactly one, ten times over", async () => {
    for (let round = 0; round < 10; round += 1) {
      await reset(client);
      await setSettings(client, { "collector.max_concurrent": 1 });

      const [a, b] = await Promise.all([
        admitCollection(request(base), { now: NOW }),
        admitCollection(request(base), { now: NOW }),
      ]);
      const admitted = [a, b].filter((r) => r.ok);
      const refused = [a, b].filter((r) => !r.ok);
      assert.equal(admitted.length, 1, `round ${round}: exactly one admitted`);
      assert.equal(refused[0].ok === false && refused[0].refusal, "busy", `round ${round}`);

      const { rows } = await client.query<{ n: string }>(
        "select count(*)::text as n from public.collection_requests",
      );
      assert.equal(rows[0].n, "1", `round ${round}: never two queued rows`);
    }
  });

  await t.test("the same request key submitted twice at once creates one request", async () => {
    for (let round = 0; round < 5; round += 1) {
      await reset(client);
      await setSettings(client, { "collector.max_concurrent": 5 });
      const submission = request(base);

      const [a, b] = await Promise.all([
        admitCollection(submission, { now: NOW }),
        admitCollection(submission, { now: NOW }),
      ]);
      assert.ok(a.ok && b.ok, `round ${round}`);
      assert.equal(a.requestId, b.requestId, `round ${round}: one request, two answers`);
      assert.equal([a.reused, b.reused].filter(Boolean).length, 1, `round ${round}: exactly one reuse`);

      const { rows } = await client.query<{ n: string }>(
        "select count(*)::text as n from public.collection_requests",
      );
      assert.equal(rows[0].n, "1", `round ${round}`);
    }
  });
});

test("the request belongs to the caller, and nothing exposes admission yet", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  const restoreSettings = await snapshotSettings(client);
  t.after(async () => {
    await reset(client);
    await restoreSettings();
    await client.end();
    await closePool();
  });

  await t.test("requested_by is the caller's own id", async () => {
    await reset(client);
    await setSettings(client);
    const result = await admitCollection(request(base), { now: NOW });
    assert.ok(result.ok);
    const { rows } = await client.query<{ requested_by: string }>(
      "select requested_by from public.collection_requests where id = $1", [result.requestId],
    );
    assert.equal(rows[0].requested_by, base.userId, "admission never attributes to anyone else");
  });

  await t.test("no route exposes admission in this ticket", () => {
    // The authorization precondition is the caller's: admission is internal
    // infrastructure, and the HTTP surface that will enforce analyst-or-above
    // arrives with its own ticket. Until then there is no entry point at all,
    // so no viewer can reach it.
    const routes = walkRoutes("app");
    const callers = routes.filter((file) => readFileSync(file, "utf8").includes("collect/admission"));
    assert.deepEqual(callers, [], "an entry point must arrive with its own authorization test");
  });
});

test("admission cannot start a provider run", { skip: false }, () => {
  const source = readFileSync("lib/collect/admission.ts", "utf8");
  // Structural: the module does not import the provider at all, so no future
  // edit can reach startRun without this failing first.
  assert.doesNotMatch(source, /from "\.\/(apify|provider|mock)\.ts"/);
  assert.doesNotMatch(source, /startRun|api\.apify|fetch\(/);
  // The only write it makes is the queued request and its audit row.
  assert.doesNotMatch(source, /update public\.collection_requests/);
  assert.match(source, /insert into public\.collection_requests/);
});
