import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLLECTOR_SETTING_RULES } from "../lib/collect/admin.ts";
import {
  COLLECTION_DTO_KEYS, COLLECTION_VIEW_COLUMNS, PRODUCT_STATUSES,
  malformedBody, parseStartInput, productStatus, refusalResponse, statusLabel, toCollectionDto,
  type CollectionRequestRow,
} from "../lib/collect/dto.ts";

/**
 * C13 — the user-facing boundary, without a database.
 *
 * The DTO is an allowlist, so these cases are about what is NOT there as much
 * as what is: no provider, no cost, no internal state name, in any status.
 */

const row = (overrides: Partial<CollectionRequestRow> = {}): CollectionRequestRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  requested_by: "22222222-2222-4222-8222-222222222222",
  status: "running",
  requires_admin: false,
  params: { keyword: "วิตามิน", country: "TH", active_status: "active", max_records: 300 },
  category_id: "33333333-3333-4333-8333-333333333333",
  dataset_name: "วิตามิน · TH · 2026-09-11",
  source_url: "https://www.facebook.com/ads/library/?q=%E0%B8%A7",
  provider_item_count: 133,
  result: { ads: 133, pages: 42, unresolved: 0, quarantined: 0 },
  stop_reason: "limit_reached",
  collection_run_id: null,
  dataset_id: null,
  created_at: "2026-09-11T09:00:00.000Z",
  started_at: "2026-09-11T09:09:12.548Z",
  finished_at: null,
  updated_at: "2026-09-11T09:20:00.000Z",
  ...overrides,
});

test("the DTO is exactly the agreed key set, in every status", () => {
  for (const status of [
    "queued", "starting", "provider_start_uncertain", "running", "settling",
    "importing", "succeeded", "failed",
  ]) {
    for (const requiresAdmin of [false, true]) {
      const dto = toCollectionDto(row({ status, requires_admin: requiresAdmin }));
      assert.deepEqual(
        Object.keys(dto).sort(),
        [...COLLECTION_DTO_KEYS].sort(),
        `${status} (requires_admin=${requiresAdmin})`,
      );
    }
  }
});

test("no provider, cost or internal state name can reach a user", () => {
  // A row carrying every internal value a leak would expose.
  const dangerous = {
    ...row({ status: "provider_start_uncertain", requires_admin: true }),
    provider: "apify",
    provider_run_id: "SwEWkJk0kp6sg4QMY",
    provider_dataset_id: "DS-secret",
    provider_actor: "curious_coder/facebook-ads-library-scraper",
    provider_actor_build: "2.7.25",
    error_class: "provider_result_unsettled",
    error_detail: "the provider said something",
    cost_reserved_usd: "0.100000",
    cost_provisional_usd: "0.099800",
    cost_final_usd: "0.099800",
    lease_owner: "worker-1",
  } as unknown as CollectionRequestRow;

  const json = JSON.stringify(toCollectionDto(dangerous));
  for (const secret of [
    "apify", "Apify", "actor", "Actor", "SwEWkJk0kp6sg4QMY", "DS-secret", "2.7.25",
    "provider_result_unsettled", "the provider said something", "0.0998", "0.1000", "worker-1",
    "cost", "reservation", "lease",
  ]) {
    assert.ok(!json.includes(secret), `${secret} must not appear in a user response`);
  }
});

test("internal states map to product statuses a person can act on", () => {
  const mapping: Record<string, string> = {
    queued: "queued",
    starting: "collecting",
    running: "collecting",
    // Never a provider concept: a person is told the round is being checked.
    provider_start_uncertain: "checking",
    settling: "checking",
    importing: "processing",
    succeeded: "succeeded",
    failed: "failed",
  };
  for (const [internal, product] of Object.entries(mapping)) {
    assert.equal(productStatus(internal, false), product, internal);
  }
  // A state nobody documented is never reported as finished or failed.
  assert.equal(productStatus("something-new", false), "checking");
});

test("waiting for an admin is said neutrally, whatever the request was doing", () => {
  for (const status of ["running", "settling", "provider_start_uncertain", "importing"]) {
    const dto = toCollectionDto(row({ status, requires_admin: true }));
    assert.equal(dto.status, "needs_admin");
    assert.equal(dto.statusLabel, "รอผู้ดูแลระบบตรวจสอบ");
  }
});

test("every product status has a Thai label, and none names a provider", () => {
  for (const status of PRODUCT_STATUSES) {
    const label = statusLabel(status);
    assert.ok(label.length > 0, status);
    assert.doesNotMatch(label, /apify|actor|dataset|provider/i, status);
  }
});

test("a zero result and a failure are ordinary DTOs", () => {
  const zero = toCollectionDto(row({
    status: "succeeded", provider_item_count: 0,
    result: { ads: 0, pages: 0, unresolved: 0, quarantined: 0 },
    dataset_id: null, collection_run_id: null, finished_at: "2026-09-11T09:30:00.000Z",
  }));
  assert.equal(zero.status, "succeeded");
  assert.equal(zero.itemCount, 0);
  assert.equal(zero.datasetId, null);

  const failed = toCollectionDto(row({ status: "failed", finished_at: "2026-09-11T09:30:00.000Z" }));
  assert.equal(failed.status, "failed");
  assert.equal(failed.statusLabel, "ไม่สามารถเก็บข้อมูลรอบนี้ได้");
});

// --- input ------------------------------------------------------------------------

test("only collection concepts are read from a request body", () => {
  const parsed = parseStartInput({
    keyword: "  วิตามิน  ", country: "TH", activeStatus: "all", maxRecords: 300,
    categoryId: "33333333-3333-4333-8333-333333333333", datasetName: " Campaign A ",
    requestKey: "key-1",
    // Everything below is the server's business and must be ignored outright.
    actorId: "someone/else", actorBuild: "9.9.9", datasetId: "DS-x", runId: "RUN-x",
    token: "apify_api_XXXX", proxy: { useApifyProxy: true }, memoryMbytes: 4096,
    maxTotalChargeUsd: "99.00", sourceUrl: "https://api.apify.test/v2/acts",
  });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, {
    keyword: "วิตามิน", country: "TH", activeStatus: "all", maxRecords: 300,
    categoryId: "33333333-3333-4333-8333-333333333333", datasetName: "Campaign A",
    requestKey: "key-1",
  });
});

test("a request missing what a collection needs is refused before it costs anything", () => {
  const base = {
    keyword: "วิตามิน", country: "TH", activeStatus: "active", maxRecords: 300,
    categoryId: "33333333-3333-4333-8333-333333333333", requestKey: "key-1",
  };
  for (const [field, value] of [
    ["keyword", "   "], ["country", ""], ["categoryId", null], ["requestKey", null],
  ] as const) {
    const parsed = parseStartInput({ ...base, [field]: value });
    assert.equal(parsed.ok, false, field);
  }
  // A category is never invented from the keyword.
  assert.equal(parseStartInput({ ...base, categoryId: undefined }).ok, false);
  for (const maxRecords of [0, -1, 1.5, "300", null]) {
    assert.equal(parseStartInput({ ...base, maxRecords }).ok, false, String(maxRecords));
  }
  assert.equal(parseStartInput(null).ok, false);
  assert.equal(parseStartInput("not json").ok, false);
});

test("an unrecognised active status is the safe one", () => {
  const parsed = parseStartInput({
    keyword: "x", country: "TH", activeStatus: "everything", maxRecords: 10,
    categoryId: "c", requestKey: "k",
  });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.activeStatus, "active");
});

// --- refusals ---------------------------------------------------------------------

test("every admission refusal is a 409 by reason, and says nothing about the machinery", () => {
  // A well-formed request that admission refuses is a conflict with the state of
  // the collector, not a malformed request. The code is what a client acts on.
  for (const refusal of ["not_configured", "budget_reached", "busy", "invalid_request"] as const) {
    const response = refusalResponse(refusal);
    assert.equal(response.status, 409, refusal);
    assert.equal(response.code, refusal, "a machine-readable reason survives");
    assert.ok(response.message.length > 0);
    assert.doesNotMatch(response.message, /[0-9]+[.][0-9]{2}|usd|[$]|apify|actor|token/i, refusal);
  }
});

test("only a body that is not a request at all is a 400", () => {
  const malformed = malformedBody("keyword is required");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.code, "invalid_body");
  // The detail names the field, because the client can fix that itself.
  assert.equal(malformed.detail, "keyword is required");
  assert.doesNotMatch(malformed.message, /apify|actor|token|usd/i);
});

// --- the routes themselves ---------------------------------------------------------

const route = (...parts: string[]) => readFileSync(join("app", "api", ...parts), "utf8");

test("the user routes end at admission and never reach a provider start", () => {
  const collections = route("collections", "route.ts");
  const detail = route("collections", "[id]", "route.ts");

  for (const source of [collections, detail]) {
    assert.doesNotMatch(source, /startRun|POST \/v2|api\.apify|APIFY_TOKEN/);
    // No route computes budget, ceiling or concurrency for itself.
    assert.doesNotMatch(source, /assessBudget|windowCommitment|monthly_budget|max_concurrent/);
    // And none of them writes a request row directly.
    assert.doesNotMatch(source, /insert into public\.collection_requests/);
  }
  // Admission is the only way in.
  assert.match(collections, /admitCollection\(/);
  assert.equal(collections.match(/admitCollection\(/g)?.length, 1);
  // The requester is the authenticated human.
  assert.match(collections, /requestedBy: actor\.userId/);
  // The answer does not wait for the provider: one step, after the response.
  assert.match(collections, /after\(\(\) => firstAdvance/);
  assert.equal(collections.match(/advance\(/g)?.length, 1);

  // The poll is poll-only in the claim itself, not by reading a status first.
  assert.match(detail, /advance\(requestId, \{ provider, allowStart: false \}\)/);
  assert.doesNotMatch(detail, /canNudge|internalStatusOf/);
  assert.equal(detail.match(/advance\(/g)?.length, 1);
});

test("no C13 route reaches the privileged client, in any spelling", () => {
  for (const parts of [
    ["collections", "route.ts"], ["collections", "[id]", "route.ts"],
    ["collections", "[id]", "diagnostics", "route.ts"], ["collections", "[id]", "recovery", "route.ts"],
    ["collector", "usage", "route.ts"], ["collector", "settings", "route.ts"],
  ]) {
    const source = route(...parts);
    // Both spellings: the alias the import checker scans for, and the relative
    // one it currently cannot see.
    assert.doesNotMatch(source, /db\/privileged/, parts.join("/"));
    assert.doesNotMatch(source, /withTransaction/, parts.join("/"));
  }
});

test("every route states its own authorization", () => {
  assert.match(route("collections", "route.ts"), /requireRole\("analyst"\)/);
  assert.match(route("collections", "[id]", "route.ts"), /requireRole\("analyst"\)/);
  assert.match(route("collections", "[id]", "recovery", "route.ts"), /requireRole\("admin"\)/);
  // The admin read surfaces check inside the service, which is stricter: the
  // boundary does not depend on the route file being written correctly.
  assert.match(route("collections", "[id]", "diagnostics", "route.ts"), /getActor\(\)/);
  assert.match(route("collector", "usage", "route.ts"), /getActor\(\)/);
  assert.match(route("collector", "settings", "route.ts"), /getActor\(\)/);
  const admin = readFileSync(join("lib", "collect", "admin.ts"), "utf8");
  assert.equal(admin.match(/requireAdmin\(actor\)/g)?.length, 3);
});

test("the normal read path selects the user-safe view, by name", () => {
  const read = readFileSync(join("lib", "collect", "read.ts"), "utf8");
  // The caller's own client: RLS decides which rows exist.
  assert.match(read, /dbUser\(\)/);
  assert.doesNotMatch(read, /privileged/);
  assert.match(read, /collection_request_status/);
  assert.doesNotMatch(read, /from\("collection_requests"\)/);
  for (const column of [
    "provider_run_id", "provider_dataset_id", "error_class", "error_detail",
    "cost_reserved_usd", "cost_provisional_usd", "cost_final_usd", "lease_owner",
  ]) {
    assert.ok(!COLLECTION_VIEW_COLUMNS.includes(column as never), `${column} is not user-safe`);
  }
});

// --- collector settings ------------------------------------------------------------

test("every collector setting the migration seeds has a validation rule, and no other key does", () => {
  // The 21 keys C04 seeds, and nothing else: the settings API is not a way to
  // edit unrelated application state, and no secret is settable at all.
  const seeded = [
    "monthly_budget_usd", "max_charge_per_run_usd", "estimated_usd_per_1000_ads",
    "billing_cycle_anchor", "billing_cycle_length_months",
    "max_records_per_run", "max_export_bytes", "run_timeout_minutes",
    "reconcile_window_minutes", "reconcile_page_size",
    "cost_settle_minutes", "cost_final_window_hours",
    "result_settle_seconds", "result_settle_window_minutes",
    "tick_batch", "actor_build",
    "max_concurrent", "lease_seconds", "actor", "countries", "enabled",
  ];
  assert.equal(seeded.length, 21);
  assert.deepEqual(Object.keys(COLLECTOR_SETTING_RULES).sort(), [...seeded].sort());
  for (const key of ["APIFY_TOKEN", "token", "COLLECTION_ADVANCE_TOKEN", "service_role_key"]) {
    assert.ok(!(key in COLLECTOR_SETTING_RULES), `${key} must not be settable`);
  }
});

test("each rule says what it accepts, derived from the consumer that reads it", () => {
  const accepts = (key: string, value: unknown) => COLLECTOR_SETTING_RULES[key].check(value);

  // A lease of zero would expire the instant it is taken (C08 claim).
  assert.equal(accepts("lease_seconds", 0), false);
  assert.equal(accepts("lease_seconds", 120), true);
  assert.equal(accepts("lease_seconds", null), false, "the machine cannot run without one");

  // C05 refuses a negative budget, and permits zero.
  assert.equal(accepts("monthly_budget_usd", 0), true);
  assert.equal(accepts("monthly_budget_usd", -1), false);
  // But a per-run ceiling of zero is refused there, so it is refused here.
  assert.equal(accepts("max_charge_per_run_usd", 0), false);
  assert.equal(accepts("max_charge_per_run_usd", 0.5), true);
  // Money is exact to six decimals.
  assert.equal(accepts("monthly_budget_usd", 1.1234567), false);

  // Whole numbers where the code needs whole numbers.
  assert.equal(accepts("max_concurrent", 1), true);
  assert.equal(accepts("max_concurrent", 0), false);
  assert.equal(accepts("result_settle_seconds", 30), true);
  assert.equal(accepts("result_settle_seconds", 30.5), false);
  // Durations that may be fractional, but never zero.
  assert.equal(accepts("cost_settle_minutes", 7.5), true);
  assert.equal(accepts("cost_settle_minutes", 0), false);

  // Caps the code already enforces elsewhere.
  assert.equal(accepts("max_records_per_run", 4_970), true);
  assert.equal(accepts("max_records_per_run", 4_971), false);
  assert.equal(accepts("max_export_bytes", 25 * 1024 * 1024), true);
  assert.equal(accepts("max_export_bytes", 25 * 1024 * 1024 + 1), false);

  // Shapes the provider and the URL builder demand.
  assert.equal(accepts("actor", "curious_coder~facebook-ads-library-scraper"), true);
  assert.equal(accepts("actor", "curious_coder/facebook-ads-library-scraper"), false);
  assert.equal(accepts("countries", ["TH"]), true);
  assert.equal(accepts("countries", ["th"]), false);
  assert.equal(accepts("countries", []), false);
  assert.equal(accepts("billing_cycle_anchor", "2026-09-01"), true);
  assert.equal(accepts("billing_cycle_anchor", "2026-13-01"), false);

  assert.equal(accepts("enabled", true), true);
  assert.equal(accepts("enabled", "true"), false);
  // Every seeded-null setting may be set back to unset: it fails closed.
  for (const key of ["monthly_budget_usd", "tick_batch", "actor_build", "cost_settle_minutes"]) {
    assert.equal(accepts(key, null), true, key);
  }
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -Number.MAX_VALUE]) {
    assert.equal(accepts("tick_batch", value), false, String(value));
  }
});
