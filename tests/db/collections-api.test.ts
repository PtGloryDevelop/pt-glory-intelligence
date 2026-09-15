import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { connect, createAuthUser } from "./helpers.ts";
import { admitCollection } from "../../lib/collect/admission.ts";
import { advance } from "../../lib/collect/machine.ts";
import { createMockProvider, mockRun, type MockProvider, type MockScript } from "../../lib/collect/mock.ts";
import {
  COLLECTION_DTO_KEYS, COLLECTION_VIEW_COLUMNS, parseStartInput, refusalResponse, toCollectionDto,
  type CollectionRequestRow,
} from "../../lib/collect/dto.ts";
import { readCollectorUsage, readDiagnostics, updateCollectorSettings } from "../../lib/collect/admin.ts";
import { closePool } from "../../lib/db/privileged.ts";
import type { Actor } from "../../lib/auth/role-model.ts";

/**
 * C13 — the API boundary against the real database.
 *
 * The route files are thin by design, so what is proved here is the behaviour
 * behind them: admission is the only way a collection is created, the DTO is
 * built from the user-safe view, and the admin surfaces refuse anyone else.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const SETTINGS: Record<string, unknown> = {
  "collector.enabled": true,
  "collector.monthly_budget_usd": 20,
  "collector.max_charge_per_run_usd": 0.5,
  "collector.billing_cycle_anchor": "2026-09-01",
  "collector.billing_cycle_length_months": 1,
  "collector.max_records_per_run": 500,
  "collector.max_concurrent": 5,
  "collector.actor_build": "2.7.25",
  "collector.countries": ["TH"],
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
    await client.query("delete from public.app_settings where key like 'collector.%'");
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
    return createAuthUser(client, `c13-${label}-${randomUUID()}@example.test`);
  };
  const analystId = await user("analyst");
  const otherId = await user("other");
  const adminId = await user("admin");
  const { rows: category } = await client.query<{ id: string }>(
    "insert into public.categories (name) values ($1) returning id",
    [`C13 ${randomUUID().slice(0, 8)}`],
  );
  return { analystId, otherId, adminId, categoryId: category[0].id };
}

const NOW = new Date("2026-09-11T09:00:00.000Z");

/** Exactly what the route does: parse a body, then hand it to admission. */
async function startFromBody(body: unknown, requestedBy: string) {
  const parsed = parseStartInput(body);
  if (!parsed.ok) return { parsed, admitted: null };
  const admitted = await admitCollection({ ...parsed.value, requestedBy }, { now: NOW });
  return { parsed, admitted };
}

const validBody = (categoryId: string, overrides: Record<string, unknown> = {}) => ({
  keyword: "วิตามินสลายไขมัน",
  country: "TH",
  activeStatus: "active",
  maxRecords: 300,
  categoryId,
  datasetName: null,
  requestKey: randomUUID(),
  ...overrides,
});

/** The row as the user-safe view returns it, read by the exact DTO column list. */
async function viewRow(client: pg.Client, id: string): Promise<CollectionRequestRow> {
  const { rows } = await client.query<CollectionRequestRow>(
    `select ${COLLECTION_VIEW_COLUMNS.join(", ")} from public.collection_request_status where id = $1`,
    [id],
  );
  return rows[0];
}

const actor = (userId: string, role: Actor["role"]): Actor => ({ userId, role });

const provider = (script: MockScript = {}): MockProvider =>
  createMockProvider(script, { PT_GLORY_ENV: "test" });

/** What GET /api/collections/:id does after answering: a poll that cannot start. */
const pollOnlyNudge = (requestId: string, mock: MockProvider) =>
  advance(requestId, { provider: mock, worker: "poll", allowStart: false });

// --- starting a collection ---------------------------------------------------------

test("a collection is created by admission and nothing else", { skip }, async (t) => {
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
  await client.query("delete from public.collection_requests");

  await t.test("an analyst's request becomes a queued row owned by that person", async () => {
    const { admitted } = await startFromBody(validBody(base.categoryId), base.analystId);
    assert.ok(admitted?.ok);

    const { rows } = await client.query<{
      requested_by: string; status: string; start_attempted_at: string | null;
      provider_run_id: string | null; cost_status: string; dataset_name: string;
    }>(
      `select requested_by, status, start_attempted_at, provider_run_id, cost_status, dataset_name
         from public.collection_requests where id = $1`,
      [admitted.requestId],
    );
    const row = rows[0];
    assert.equal(row.requested_by, base.analystId, "the initiating human owns the request");
    assert.equal(row.status, "queued");
    assert.equal(row.start_attempted_at, null, "no provider was contacted by the request itself");
    assert.equal(row.provider_run_id, null);
    assert.equal(row.cost_status, "reserved", "the ceiling is held before anything runs");
    assert.equal(row.dataset_name, "วิตามินสลายไขมัน · TH · 2026-09-11", "named once, at admission");
  });

  await t.test("the response a person receives is the DTO, and only the DTO", async () => {
    const { admitted } = await startFromBody(validBody(base.categoryId), base.analystId);
    assert.ok(admitted?.ok);
    const dto = toCollectionDto(await viewRow(client, admitted.requestId));

    assert.deepEqual(Object.keys(dto).sort(), [...COLLECTION_DTO_KEYS].sort());
    assert.equal(dto.status, "queued");
    assert.equal(dto.requestedBy, base.analystId);
    assert.equal(dto.keyword, "วิตามินสลายไขมัน");
    // The reservation admission just made is nowhere in it.
    assert.ok(!JSON.stringify(dto).includes("0.5"), "no ceiling, no reservation, no budget");
  });

  await t.test("a category that does not exist is refused, and none is invented", async () => {
    const before = await count(client);
    const { admitted } = await startFromBody(
      validBody(randomUUID()), base.analystId,
    );
    assert.ok(admitted && !admitted.ok);
    assert.equal(admitted.refusal, "invalid_request");
    assert.equal(refusalResponse(admitted.refusal).status, 409);
    assert.equal(await count(client), before, "nothing was written");
    const { rows } = await client.query<{ n: string }>(
      "select count(*)::text as n from public.categories where name = $1", ["วิตามินสลายไขมัน"],
    );
    assert.equal(rows[0].n, "0", "a keyword never becomes a category");
  });

  await t.test("a country the server does not collect is refused safely", async () => {
    const { admitted } = await startFromBody(
      validBody(base.categoryId, { country: "US" }), base.analystId,
    );
    assert.ok(admitted && !admitted.ok);
    assert.equal(admitted.refusal, "invalid_request");
    // The message a person sees names no setting and no list.
    assert.doesNotMatch(refusalResponse(admitted.refusal).message, /TH|US|countries/);
  });

  await t.test("a record cap above the configured one is refused", async () => {
    const { admitted } = await startFromBody(
      validBody(base.categoryId, { maxRecords: 5_000 }), base.analystId,
    );
    assert.ok(admitted && !admitted.ok);
    assert.equal(admitted.refusal, "invalid_request");
  });

  await t.test("an unconfigured collector refuses without naming the setting", async () => {
    await setSettings(client, { "collector.max_records_per_run": null });
    const { admitted } = await startFromBody(validBody(base.categoryId), base.analystId);
    assert.ok(admitted && !admitted.ok);
    assert.equal(admitted.refusal, "not_configured");
    const response = refusalResponse(admitted.refusal);
    assert.equal(response.status, 409);
    assert.doesNotMatch(response.message, /max_records_per_run|setting|collector\./);
    await setSettings(client);
  await client.query("delete from public.collection_requests");
  });

  await t.test("a full budget refuses without saying how full", async () => {
    await setSettings(client, { "collector.monthly_budget_usd": 0.1 });
    await client.query(
      `insert into public.collection_requests
         (requested_by, request_key, params, category_id, cost_status, cost_reserved_usd, started_at)
       values ($1, $2, $3::jsonb, $4, 'reserved', 0.100000, now())`,
      [base.analystId, randomUUID(),
        JSON.stringify({ keyword: "x", country: "TH", active_status: "active", max_records: 10 }),
        base.categoryId],
    );
    const { admitted } = await startFromBody(validBody(base.categoryId), base.analystId);
    assert.ok(admitted && !admitted.ok);
    assert.equal(admitted.refusal, "budget_reached");
    const response = refusalResponse(admitted.refusal);
    assert.equal(response.status, 409);
    assert.doesNotMatch(response.message, /0\.1|20|usd|\$/i);
    await client.query("delete from public.collection_requests");
    await setSettings(client);
  await client.query("delete from public.collection_requests");
  });

  await t.test("a busy collector refuses without naming the request holding the slot", async () => {
    await setSettings(client, { "collector.max_concurrent": 1 });
    const { admitted: first } = await startFromBody(validBody(base.categoryId), base.analystId);
    assert.ok(first?.ok);
    const { admitted: second } = await startFromBody(validBody(base.categoryId), base.analystId);
    assert.ok(second && !second.ok);
    assert.equal(second.refusal, "busy");
    assert.equal(refusalResponse(second.refusal).status, 409);
    assert.ok(!refusalResponse(second.refusal).message.includes(first.requestId));
    await client.query("delete from public.collection_requests");
    await setSettings(client);
  await client.query("delete from public.collection_requests");
  });
});

// --- idempotency -------------------------------------------------------------------

test("the same submission twice is the same collection", { skip }, async (t) => {
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
  await client.query("delete from public.collection_requests");

  await t.test("a retry returns the original request, and buys nothing", async () => {
    const body = validBody(base.categoryId);
    const { admitted: first } = await startFromBody(body, base.analystId);
    const { admitted: again } = await startFromBody(body, base.analystId);
    assert.ok(first?.ok && again?.ok);
    assert.equal(again.requestId, first.requestId);
    assert.equal(again.reused, true, "the route answers 200 for this, not 201");
    assert.equal(await count(client), 1);
  });

  await t.test("a different person with the same key learns nothing", async () => {
    const body = validBody(base.categoryId);
    const { admitted: mine } = await startFromBody(body, base.analystId);
    assert.ok(mine?.ok);
    const { admitted: theirs } = await startFromBody(body, base.otherId);
    assert.ok(theirs && !theirs.ok);
    assert.equal(theirs.refusal, "invalid_request");
    assert.ok(!theirs.detail.includes(mine.requestId), "and never receives the other request's id");
    assert.ok(!refusalResponse(theirs.refusal).message.includes(mine.requestId));
  });

  await t.test("the same key with a different paid collection is refused", async () => {
    const body = validBody(base.categoryId);
    const { admitted: first } = await startFromBody(body, base.analystId);
    assert.ok(first?.ok);
    const before = await count(client);
    const { admitted: changed } = await startFromBody(
      { ...body, keyword: "อย่างอื่น" }, base.analystId,
    );
    assert.ok(changed && !changed.ok);
    assert.equal(changed.refusal, "invalid_request");
    assert.equal(await count(client), before, "no second request exists");
  });

  await t.test("a different label is not a different collection", async () => {
    const body = validBody(base.categoryId, { datasetName: "Campaign A" });
    const { admitted: first } = await startFromBody(body, base.analystId);
    assert.ok(first?.ok);
    const { admitted: relabelled } = await startFromBody(
      { ...body, datasetName: "Campaign B" }, base.analystId,
    );
    assert.ok(relabelled?.ok);
    assert.equal(relabelled.requestId, first.requestId);
    assert.equal(relabelled.reused, true);
    const { rows } = await client.query<{ dataset_name: string }>(
      "select dataset_name from public.collection_requests where id = $1", [first.requestId],
    );
    assert.equal(rows[0].dataset_name, "Campaign A", "and the stored name is not rewritten");
  });
});

// --- the DTO against real rows -------------------------------------------------------

test("every status a request can reach still answers with a safe DTO", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  t.after(async () => {
    await client.query("delete from public.collection_requests");
    await client.end();
    await closePool();
  });
  await client.query("delete from public.collection_requests");

  await t.test("failed, uncertain and zero-result rows carry nothing internal", async () => {
    const cases = [
      { status: "provider_start_uncertain", requires_admin: true, start_attempted_at: NOW.toISOString() },
      {
        status: "settling", requires_admin: true, error_class: "provider_result_unsettled",
        error_detail: "provider said the dataset was not ready",
        provider: "apify", provider_run_id: "SwEWkJk0kp6sg4QMY", provider_dataset_id: "DS-secret",
        provider_actor_build: "2.7.25", started_at: NOW.toISOString(),
      },
      {
        status: "failed", error_class: "provider_run_failed", finished_at: NOW.toISOString(),
        provider_run_id: `RUN-${randomUUID()}`, cost_status: "final", cost_final_usd: "0.099800",
        started_at: NOW.toISOString(),
      },
      {
        status: "succeeded", finished_at: NOW.toISOString(), provider_item_count: 0,
        result: JSON.stringify({ ads: 0, pages: 0, unresolved: 0, quarantined: 0 }),
        provider_run_id: `RUN-${randomUUID()}`, started_at: NOW.toISOString(),
      },
    ];

    for (const overrides of cases) {
      const columns: Record<string, unknown> = {
        requested_by: base.analystId, request_key: randomUUID(),
        params: JSON.stringify({ keyword: "วิตามิน", country: "TH", active_status: "active", max_records: 300 }),
        category_id: base.categoryId, dataset_name: "วิตามิน · TH · 2026-09-11",
        source_url: "https://www.facebook.com/ads/library/?q=x",
        cost_reserved_usd: "0.100000", ...overrides,
      };
      const names = Object.keys(columns);
      const placeholders = names.map((name, i) =>
        (name === "params" || name === "result" ? `$${i + 1}::jsonb` : `$${i + 1}`));
      const { rows } = await client.query<{ id: string }>(
        `insert into public.collection_requests (${names.join(", ")})
         values (${placeholders.join(", ")}) returning id`,
        Object.values(columns),
      );

      const dto = toCollectionDto(await viewRow(client, rows[0].id));
      assert.deepEqual(Object.keys(dto).sort(), [...COLLECTION_DTO_KEYS].sort(), String(overrides.status));
      const json = JSON.stringify(dto);
      for (const secret of [
        "apify", "SwEWkJk0kp6sg4QMY", "DS-secret", "2.7.25", "provider_result_unsettled",
        "provider_run_failed", "provider said", "0.0998", "0.1000", "RUN-",
      ]) {
        assert.ok(!json.includes(secret), `${secret} in a ${overrides.status} response`);
      }
    }
  });

  await t.test("the user-safe view carries no admin column at all", async () => {
    const { rows } = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'collection_request_status'",
    );
    const columns = rows.map((row) => row.column_name);
    for (const forbidden of [
      "provider", "provider_actor", "provider_actor_build", "provider_run_id", "provider_dataset_id",
      "error_class", "error_detail", "cost_status", "cost_reserved_usd", "cost_provisional_usd",
      "cost_final_usd", "cost_next_check_at", "lease_owner", "lease_expires_at", "next_check_at",
      "result_item_count", "reservation_released_at",
    ]) {
      assert.ok(!columns.includes(forbidden), `${forbidden} must not be in the user-facing view`);
    }
  });

  await t.test("a normal client still cannot write a collection request", async () => {
    for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
      const { rows } = await client.query<{ allowed: boolean }>(
        "select has_table_privilege('authenticated', 'public.collection_requests', $1) as allowed",
        [privilege],
      );
      assert.equal(rows[0].allowed, false, `authenticated must not ${privilege} collection_requests`);
    }
  });
});

// --- admin surfaces ------------------------------------------------------------------

test("the admin surfaces belong to admins", { skip }, async (t) => {
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
  await client.query("delete from public.collection_requests");

  const { admitted } = await startFromBody(validBody(base.categoryId), base.analystId);
  assert.ok(admitted?.ok);
  const requestId = admitted.requestId;

  await t.test("viewer, analyst and nobody are all refused", async () => {
    for (const who of [null, actor(base.analystId, "viewer"), actor(base.analystId, "analyst")]) {
      await assert.rejects(readDiagnostics(who, requestId), /role|Sign in/);
      await assert.rejects(readCollectorUsage(who), /role|Sign in/);
      await assert.rejects(updateCollectorSettings(who, { tick_batch: 5 }), /role|Sign in/);
    }
  });

  await t.test("an admin sees the internal evidence a person cannot", async () => {
    const diagnostics = await readDiagnostics(actor(base.adminId, "admin"), requestId);
    assert.ok(diagnostics);
    for (const key of [
      "provider_run_id", "provider_dataset_id", "error_class", "error_detail",
      "cost_status", "cost_reserved_usd", "lease_owner", "next_check_at",
    ]) {
      assert.ok(key in diagnostics, `diagnostics must include ${key}`);
    }
    assert.equal(await readDiagnostics(actor(base.adminId, "admin"), randomUUID()), null);
  });

  await t.test("usage reports holds as holds, and says when a figure is unsettled", async () => {
    const usage = await readCollectorUsage(actor(base.adminId, "admin"));
    assert.equal(usage.heldReservationUsd, "0.500000", "the admitted ceiling is held");
    assert.equal(usage.finalizedActualCostUsd, "0.000000", "and nothing is reported as spent");
    assert.equal(usage.monthlyBudgetUsd, "20.000000");
    assert.equal(usage.availableUsd, "19.500000");
    assert.equal(usage.containsProvisional, false);
    assert.ok(usage.window);

    await client.query(
      `update public.collection_requests
          set cost_status = 'provisional', cost_provisional_usd = 0.099800,
              cost_provisional_observed_at = now(), started_at = now()
        where id = $1`, [requestId],
    );
    const moving = await readCollectorUsage(actor(base.adminId, "admin"));
    assert.equal(moving.containsProvisional, true, "a provisional figure is labelled as such");
    assert.equal(moving.heldReservationUsd, "0.500000", "and the larger hold still stands");
    assert.equal(moving.finalizedActualCostUsd, "0.000000");
  });

  await t.test("a value that would break a frozen consumer is refused", async () => {
    const admin = actor(base.adminId, "admin");
    const auditCount = async () => {
      const { rows } = await client.query<{ n: string }>(
        "select count(*)::text as n from public.audit_logs where action = 'collector.settings_updated'",
      );
      return Number(rows[0].n);
    };
    const settingOf = async (key: string) => {
      const { rows } = await client.query<{ value: unknown }>(
        "select value from public.app_settings where key = $1", [`collector.${key}`],
      );
      return rows[0]?.value ?? null;
    };

    const before = { lease: await settingOf("lease_seconds"), audits: await auditCount() };

    const refusals: [string, unknown][] = [
      // A lease of zero expires the moment it is taken: two workers would then
      // claim the same request, which is the guarantee C08-C12 rest on.
      ["lease_seconds", 0],
      ["lease_seconds", -30],
      ["lease_seconds", 12.5],
      ["lease_seconds", Number.NaN],
      ["lease_seconds", Number.POSITIVE_INFINITY],
      ["max_concurrent", 0],
      ["max_concurrent", 1.5],
      // C05 refuses a per-run ceiling of zero.
      ["max_charge_per_run_usd", 0],
      ["max_charge_per_run_usd", -1],
      // Money is exact to six decimals; more cannot be held.
      ["monthly_budget_usd", 1.12345678],
      // Whole seconds: it becomes make_interval(secs => $n::int).
      ["result_settle_seconds", 30.5],
      ["result_settle_seconds", 0],
      ["run_timeout_minutes", 0],
      ["tick_batch", 0],
      ["reconcile_page_size", 0],
      ["cost_settle_minutes", 0],
      ["cost_final_window_hours", 0],
      ["billing_cycle_length_months", 0],
      ["billing_cycle_anchor", "01/09/2026"],
      ["billing_cycle_anchor", "2026-13-01"],
      // Beyond what the code can honour: the export is clamped, the request cap refused.
      ["max_export_bytes", 26_214_401],
      ["max_records_per_run", 4_971],
      ["actor", "curious_coder/facebook-ads-library-scraper"],
      ["actor", ""],
      ["actor_build", "  "],
      ["countries", []],
      ["countries", ["TH", ""]],
      ["countries", ["Thailand"]],
      ["enabled", "true"],
      ["not_a_setting", 1],
      ["APIFY_TOKEN", "apify_api_secret"],
    ];
    for (const [key, value] of refusals) {
      const result = await updateCollectorSettings(admin, { [key]: value });
      assert.equal(result.ok, false, `${key}=${JSON.stringify(value)} must be refused`);
    }

    assert.deepEqual(await settingOf("lease_seconds"), before.lease, "nothing was written");
    assert.equal(await auditCount(), before.audits, "and nothing was audited");
  });

  await t.test("zero is kept where a frozen consumer permits it", async () => {
    const admin = actor(base.adminId, "admin");
    // C05 refuses only a NEGATIVE monthly budget: zero is how spending stops.
    assert.equal((await updateCollectorSettings(admin, { monthly_budget_usd: 0 })).ok, true);
    const { rows } = await client.query<{ value: unknown }>(
      "select value from public.app_settings where key = 'collector.monthly_budget_usd'",
    );
    assert.equal(rows[0].value, 0);
    await updateCollectorSettings(admin, { monthly_budget_usd: 20 });
  });

  await t.test("a patch is all or nothing", async () => {
    const admin = actor(base.adminId, "admin");
    const { rows: beforeRows } = await client.query<{ key: string; value: unknown }>(
      "select key, value from public.app_settings where key in ('collector.tick_batch', 'collector.lease_seconds')",
    );
    const { rows: beforeAudit } = await client.query<{ n: string }>(
      "select count(*)::text as n from public.audit_logs where action = 'collector.settings_updated'",
    );

    // One good value, one that would break the lease.
    const result = await updateCollectorSettings(admin, { tick_batch: 9, lease_seconds: 0 });
    assert.equal(result.ok, false);

    const { rows: afterRows } = await client.query<{ key: string; value: unknown }>(
      "select key, value from public.app_settings where key in ('collector.tick_batch', 'collector.lease_seconds')",
    );
    assert.deepEqual(afterRows, beforeRows, "not one key of the patch was written");
    const { rows: afterAudit } = await client.query<{ n: string }>(
      "select count(*)::text as n from public.audit_logs where action = 'collector.settings_updated'",
    );
    assert.equal(afterAudit[0].n, beforeAudit[0].n, "and no partial audit was recorded");

    // The same patch with a valid lease writes both, and audits both.
    const good = await updateCollectorSettings(admin, { tick_batch: 9, lease_seconds: 150 });
    assert.ok(good.ok);
    assert.deepEqual(good.changed.sort(), ["collector.lease_seconds", "collector.tick_batch"]);
    const { rows: audited } = await client.query<{ actor: string; before: unknown; after: unknown }>(
      "select actor, before, after from public.audit_logs where action = 'collector.settings_updated' order by created_at desc limit 2",
    );
    assert.equal(audited.length, 2);
    for (const row of audited) assert.equal(row.actor, base.adminId);
  });

  await t.test("settings are allowlisted, audited and type-checked", async () => {
    const admin = actor(base.adminId, "admin");
    const refused = await updateCollectorSettings(admin, { not_a_setting: 1 });
    assert.equal(refused.ok, false);
    const wrongShape = await updateCollectorSettings(admin, { tick_batch: "five" });
    assert.equal(wrongShape.ok, false);
    assert.equal((await updateCollectorSettings(admin, {})).ok, false);

    const changed = await updateCollectorSettings(admin, { tick_batch: 5, result_settle_seconds: 45 });
    assert.ok(changed.ok);
    assert.deepEqual(changed.changed.sort(), ["collector.result_settle_seconds", "collector.tick_batch"]);

    const { rows } = await client.query<{ value: unknown }>(
      "select value from public.app_settings where key = 'collector.tick_batch'",
    );
    assert.equal(rows[0].value, 5);

    const { rows: audit } = await client.query<{ actor: string; before: unknown; after: unknown }>(
      "select actor, before, after from public.audit_logs where action = 'collector.settings_updated' order by created_at desc limit 2",
    );
    assert.equal(audit.length, 2);
    assert.equal(audit[0].actor, base.adminId, "the admin who changed it is recorded");

    // Writing the same value again is not a change, and not an audit row.
    const repeat = await updateCollectorSettings(admin, { tick_batch: 5 });
    assert.ok(repeat.ok);
    assert.deepEqual(repeat.changed, []);
  });
});

async function count(client: pg.Client): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    "select count(*)::text as n from public.collection_requests",
  );
  return Number(rows[0].n);
}

// --- the poll-only read ------------------------------------------------------------

test("reading a collection can never start one", { skip }, async (t) => {
  const client = await connect();
  const base = await fixtures(client);
  const restore = await snapshotSettings(client);
  t.after(async () => {
    await client.query("delete from public.collection_requests");
    await restore();
    await client.end();
    await closePool();
  });
  await setSettings(client, { "collector.run_timeout_minutes": 10, "collector.lease_seconds": 120 });
  await client.query("delete from public.collection_requests");

  await t.test("a queued request is read, and stays exactly as it was", async () => {
    const { admitted } = await startFromBody(validBody(base.categoryId), base.analystId);
    assert.ok(admitted?.ok);
    const id = admitted.requestId;

    const before = await client.query<{ status: string; start_attempted_at: string | null; provider_run_id: string | null }>(
      "select status, start_attempted_at, provider_run_id from public.collection_requests where id = $1",
      [id],
    );
    assert.equal(before.rows[0].status, "queued");
    assert.equal(before.rows[0].start_attempted_at, null);
    assert.equal(before.rows[0].provider_run_id, null);

    // The DTO the route returns.
    assert.equal(toCollectionDto(await viewRow(client, id)).status, "queued");

    // And the nudge that follows it, ten times over.
    const mock = provider();
    for (let poll = 0; poll < 10; poll += 1) {
      const outcome = await pollOnlyNudge(id, mock);
      assert.equal(outcome.action, "not_claimed", `poll ${poll}`);
      await client.query("update public.collection_requests set next_check_at = now() where id = $1", [id]);
    }

    assert.equal(mock.startCount, 0, "a read never starts a run");
    assert.equal(mock.calls.length, 0, "and never even reaches the provider");
    const after = await client.query<{
      status: string; start_attempted_at: string | null; provider_run_id: string | null; attempt: number;
    }>(
      "select status, start_attempted_at, provider_run_id, attempt from public.collection_requests where id = $1",
      [id],
    );
    assert.equal(after.rows[0].status, "queued");
    assert.equal(after.rows[0].start_attempted_at, null, "the start marker is untouched");
    assert.equal(after.rows[0].provider_run_id, null);
    assert.equal(after.rows[0].attempt, 0, "the claim never even counted an attempt");
  });

  await t.test("a running request may be polled along", async () => {
    const { admitted } = await startFromBody(validBody(base.categoryId), base.analystId);
    assert.ok(admitted?.ok);
    const id = admitted.requestId;
    const runId = `RUN-${randomUUID()}`;
    await client.query(
      `update public.collection_requests
          set status = 'running', provider = 'apify', provider_run_id = $2,
              start_attempted_at = now(), started_at = '2026-09-11T09:09:12.548Z',
              next_check_at = now()
        where id = $1`,
      [id, runId],
    );

    const mock = provider({ run: mockRun({ runId, status: "RUNNING", finishedAt: null }) });
    const outcome = await pollOnlyNudge(id, mock);
    assert.equal(outcome.action, "still_running");
    assert.equal(mock.startCount, 0);
    const { rows } = await client.query<{ status: string }>(
      "select status from public.collection_requests where id = $1", [id],
    );
    assert.equal(rows[0].status, "running");
  });

  await t.test("settling and importing progress under a poll, and start nothing", async () => {
    for (const status of ["settling", "importing"] as const) {
      const { admitted } = await startFromBody(validBody(base.categoryId), base.analystId);
      assert.ok(admitted?.ok);
      const id = admitted.requestId;
      await client.query(
        `update public.collection_requests
            set status = $2, provider = 'apify', provider_run_id = $3, provider_dataset_id = $4,
                start_attempted_at = now(), started_at = now(), next_check_at = now()
          where id = $1`,
        [id, status, `RUN-${randomUUID()}`, `DS-${randomUUID()}`],
      );
      const mock = provider();
      const outcome = await pollOnlyNudge(id, mock);
      assert.notEqual(outcome.action, "not_claimed", `${status} is claimable by a poll`);
      assert.equal(mock.startCount, 0, status);
    }
  });

  await t.test("fifty reads after a start never produce a second one", async () => {
    const { admitted } = await startFromBody(validBody(base.categoryId), base.analystId);
    assert.ok(admitted?.ok);
    const id = admitted.requestId;

    // The one start the request is entitled to, as the POST path performs it.
    const worker = provider({
      start: {
        outcome: "started",
        run: mockRun({ runId: `RUN-${randomUUID()}`, status: "RUNNING", finishedAt: null }),
      },
    });
    assert.equal((await advance(id, { provider: worker, worker: "w1" })).action, "started");
    assert.equal(worker.startCount, 1);

    const polls = provider({ run: mockRun({ status: "RUNNING", finishedAt: null }) });
    for (let poll = 0; poll < 50; poll += 1) {
      await client.query("update public.collection_requests set next_check_at = now() where id = $1", [id]);
      await pollOnlyNudge(id, polls);
    }
    assert.equal(polls.startCount, 0, "fifty reads, no second start");
  });

  await t.test("the scheduler and the POST path still start a queued request", async () => {
    // The earlier cases left live requests holding concurrency slots.
    await client.query("delete from public.collection_requests");
    const { admitted } = await startFromBody(validBody(base.categoryId), base.analystId);
    assert.ok(admitted?.ok);
    const mock = provider({
      start: {
        outcome: "started",
        run: mockRun({ runId: `RUN-${randomUUID()}`, status: "RUNNING", finishedAt: null }),
      },
    });
    // Default options: allowStart is true, and C12 behaviour is unchanged.
    const outcome = await advance(admitted.requestId, { provider: mock, worker: "scheduler" });
    assert.equal(outcome.action, "started");
    assert.equal(mock.startCount, 1);
  });
});

// --- admission refusals over HTTP --------------------------------------------------

test("a refused admission is a conflict, never a second request", { skip }, async (t) => {
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
  await client.query("delete from public.collection_requests");

  await t.test("every invalid_request refusal answers 409 and writes nothing", async () => {
    const bodies = [
      // A category that does not exist.
      validBody(randomUUID()),
      // A country the server does not collect.
      validBody(base.categoryId, { country: "US" }),
      // A record cap above the configured one.
      validBody(base.categoryId, { maxRecords: 5_000 }),
    ];
    for (const body of bodies) {
      const before = await count(client);
      const { parsed, admitted } = await startFromBody(body, base.analystId);
      assert.ok(parsed.ok, "these are well-formed requests; only admission refuses them");
      assert.ok(admitted && !admitted.ok);
      assert.equal(admitted.refusal, "invalid_request");
      const response = refusalResponse(admitted.refusal);
      assert.equal(response.status, 409, "a well-formed request that admission refuses is a conflict");
      assert.equal(response.code, "invalid_request");
      assert.equal(await count(client), before, "and no request was created");
    }
  });

  await t.test("the same key with a different paid payload is 409, and no second request", async () => {
    const body = validBody(base.categoryId);
    const { admitted: first } = await startFromBody(body, base.analystId);
    assert.ok(first?.ok);
    const before = await count(client);

    const { admitted: changed } = await startFromBody({ ...body, maxRecords: 301 }, base.analystId);
    assert.ok(changed && !changed.ok);
    assert.equal(changed.refusal, "invalid_request");
    assert.equal(refusalResponse(changed.refusal).status, 409);
    assert.equal(await count(client), before);
  });

  await t.test("another person's key is 409, and never returns the id", async () => {
    const body = validBody(base.categoryId);
    const { admitted: mine } = await startFromBody(body, base.analystId);
    assert.ok(mine?.ok);
    const { admitted: theirs } = await startFromBody(body, base.otherId);
    assert.ok(theirs && !theirs.ok);
    assert.equal(refusalResponse(theirs.refusal).status, 409);
    assert.ok(!refusalResponse(theirs.refusal).message.includes(mine.requestId));
  });
});
