import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR).sort();
const up = files.filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"));
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
const allUp = up.map(read).join("\n");

test("every up migration has a matching down migration", () => {
  for (const file of up) {
    const down = file.replace(/\.sql$/, ".down.sql");
    assert.ok(files.includes(down), `missing ${down}`);
  }
});

test("migrations are numbered 0001..0042 with no gaps", () => {
  const numbers = up.map((f) => Number(f.slice(0, 4)));
  assert.deepEqual(numbers, Array.from({ length: 42 }, (_, i) => i + 1));
});

test("all 19 tables are created", () => {
  const expected = [
    "user_roles", "categories", "collection_runs", "datasets", "pages",
    "page_observations", "ads", "ad_observations", "dataset_ads",
    "dataset_quality", "import_quarantine", "app_settings", "audit_logs",
    "media_assets",
    // Watchlist V1 (0032): saved targets only. There is deliberately no
    // events, alerts or queue table — nothing evaluates these.
    "watch_items",
    // Brand mapping (0033). The mapping is its own table, not a column on
    // pages: a brand id written in place would erase the decision it replaced.
    "brands", "brand_page_mappings",
    // Phase 15 C04 (0037): one row per collection a person asked for, with the
    // state machine's invariants enforced as constraints.
    "collection_requests",
    "owned_ad_reports",
  ];
  for (const table of expected) {
    assert.match(allUp, new RegExp(`create table public\\.${table}\\b`), `missing ${table}`);
  }
  const created = [...allUp.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
  assert.equal(created.length, 19, `expected 19 tables, found ${created.length}`);
});

test("ads.ad_archive_id is NOT NULL UNIQUE and is_active stays nullable", () => {
  const ads = read("0008_ads.sql");
  assert.match(ads, /ad_archive_id text not null unique/);
  assert.match(ads, /is_active boolean,/, "is_active must remain nullable for unknown state");
  assert.doesNotMatch(ads, /is_active boolean not null/);
});

test("no forbidden performance column exists anywhere", () => {
  const forbidden = [
    "spend", "reach", "impressions", "likes", "engagement", "reactions",
    "comments", "shares", "ctr", "cpc", "cpa", "roas", "conversion",
  ];
  for (const column of forbidden) {
    assert.doesNotMatch(
      allUp,
      new RegExp(`^\\s+${column}\\s+(text|int|bigint|numeric|boolean)`, "im"),
      `forbidden column ${column} present`,
    );
  }
  // page_like_count is a page metric the collector really provides, and is allowed.
  assert.match(allUp, /page_like_count bigint/);
});

test("quarantine reason is limited to the two row-level causes", () => {
  // Comments legitimately name the file-level reasons; assert on the CHECK only.
  const check = read("0012_import_quarantine.sql").match(/check \(reason in \(([^)]*)\)\)/);
  assert.ok(check, "missing reason CHECK constraint");
  assert.equal(check[1], "'missing_ad_archive_id','unresolved_source_record'");
  for (const fileLevel of ["unknown_field", "schema_mismatch", "malformed_json", "count_mismatch"]) {
    assert.doesNotMatch(check[1], new RegExp(fileLevel), `${fileLevel} is file-level, not quarantine`);
  }
});

test("collection_method started as the three collectors the Extension era had", () => {
  assert.match(
    read("0004_collection_runs.sql"),
    /'network_response_observation','user_initiated_dom_observation','socialapis_api'/,
  );
});

test("0037 adds the automated method without disturbing the historical three", () => {
  const sql = read("0037_collection_requests.sql");
  const check = sql.match(/add constraint collection_runs_collection_method_check[\s\S]*?\);/);
  assert.ok(check, "0037 must restate the method CHECK");
  for (const method of [
    "network_response_observation", "user_initiated_dom_observation", "socialapis_api",
    "apify_actor_run",
  ]) {
    assert.match(check[0], new RegExp(`'${method}'`), `${method} must be accepted`);
  }
});

test("0037 states every collection request invariant in the schema", () => {
  const sql = read("0037_collection_requests.sql");
  for (const fragment of [
    // The states the architecture froze, including the settlement gate's own.
    /'queued', 'starting', 'provider_start_uncertain', 'running',/,
    /'settling',/,
    /'importing', 'succeeded', 'failed'/,
    // One name for an unresolved start, never a second equivalent.
    /'provider_start_unknown'/,
    /'provider_result_unsettled'/,
    // Cost reconciliation cannot be scheduled before a run is identified.
    /cost_next_check_at is null or provider_run_id is not null/,
    // The release is all three fields or none, with a real reason.
    // The reason has to hold something that is not whitespace; asserted as a
    // literal below, because the SQL pattern is itself a character class.
    /reservation_release_reason ~ /,
    /and cost_status = 'unreported'/,
    // Exactly-once canonical commit.
    /create unique index collection_runs_request_once/,
    // Column grants, not a table grant.
    /grant select \(/,
    /with \(security_invoker = true\)/,
  ]) {
    assert.match(sql, fragment, `0037 must contain ${fragment}`);
  }
  // No insert, update or delete policy: writes go through the server only.
  assert.ok(sql.includes(String.raw`reservation_release_reason ~ '[^[:space:]]'`),
    "a blank reason must be refused by the constraint itself");
  assert.doesNotMatch(sql, /create policy collection_requests_(insert|update|delete)/);
});

test("0037 seeds every collector setting, and invents no production default", () => {
  const sql = read("0037_collection_requests.sql");
  const fixed = {
    "collector.max_concurrent": "'1'::jsonb",
    "collector.lease_seconds": "'120'::jsonb",
    "collector.enabled": "'false'::jsonb",
  };
  const tbd = [
    "collector.monthly_budget_usd", "collector.max_charge_per_run_usd",
    "collector.estimated_usd_per_1000_ads", "collector.billing_cycle_anchor",
    "collector.billing_cycle_length_months", "collector.max_records_per_run",
    "collector.max_export_bytes", "collector.run_timeout_minutes",
    "collector.reconcile_window_minutes", "collector.reconcile_page_size",
    "collector.cost_settle_minutes", "collector.cost_final_window_hours",
    "collector.result_settle_seconds", "collector.result_settle_window_minutes",
    "collector.tick_batch", "collector.actor_build",
  ];
  for (const [key, value] of Object.entries(fixed)) {
    assert.ok(sql.includes(`('${key}', ${value})`), `${key} must be seeded ${value}`);
  }
  for (const key of tbd) {
    assert.ok(sql.includes(`('${key}', 'null'::jsonb)`), `${key} must start unset`);
  }
  // A price read from one qualification run is evidence, not a default.
  assert.doesNotMatch(sql, /0\.00075|0\.0998|2\.25/);
});

test("collection_runs separates reported provenance from computed canon", () => {
  const sql = read("0004_collection_runs.sql");
  for (const field of ["source_rows", "unique_ads", "unique_pages", "unresolved_count"]) {
    assert.match(sql, new RegExp(`reported_${field}`));
    assert.match(sql, new RegExp(`computed_${field} int not null`));
  }
  assert.match(sql, /reported_quality_summary jsonb/);
});

test("snapshot uniqueness is enforced at the schema, not the query", () => {
  const sql = read("0015_indexes.sql");
  assert.match(sql, /create unique index \w+ on public\.ad_observations \(collection_run_id, ad_ref\)/);
  assert.match(sql, /create unique index \w+ on public\.page_observations \(collection_run_id, page_ref\)/);
});

test("current_user_role is security definer with a pinned search_path", () => {
  const sql = read("0002_user_roles.sql");
  assert.match(sql, /create function public\.current_user_role\(\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
});

test("nobody can write their own role row", () => {
  const sql = read("0016_rls_policies.sql");
  for (const action of ["insert", "update", "delete"]) {
    const policy = new RegExp(`user_roles_admin_${action}[\\s\\S]*?;`, "i");
    const match = sql.match(policy);
    assert.ok(match, `missing user_roles_admin_${action}`);
    assert.match(match[0], /user_id <> auth\.uid\(\)/, `${action} policy must exclude self`);
  }
});

test("no separate hide-deleted policy is reintroduced", () => {
  // Permissive SELECT policies OR together; a standalone deleted_at policy used
  // to let any authenticated caller read every non-deleted row. The condition
  // must stay inside the single read policy.
  const sql = read("0016_rls_policies.sql");
  assert.doesNotMatch(sql, /hide_deleted/, "fold deleted_at into the read policy instead");
  assert.match(
    sql,
    /current_user_role\(\) is not null and deleted_at is null/,
    "soft-delete tables must AND both conditions in one policy",
  );
});

test("every function a migration creates is dropped by its rollback", () => {
  // Deduplicated: a later migration may drop and recreate a function to change
  // its OUT columns, which CREATE OR REPLACE cannot do. 0021 does exactly that
  // to dataset_context.
  const created = [...new Set(
    [...allUp.matchAll(/create function public\.(\w+)/g)].map((m) => m[1]),
  )].sort();
  assert.deepEqual(created, [
    "ad_detail", "ad_observation_history",
    // Brand mapping (0033). One temporal rule, read by everything else here,
    // plus the two mutations that have to be atomic.
    "brand_detail", "brand_list", "brand_map_page", "brand_mapping_at",
    "brand_mapping_history", "brand_normalized_name", "brand_pages",
    "brand_unmap_page",
    // Category workspace (0028). Read-only, like every function here.
    "category_activity", "category_creative_mix", "category_datasets",
    "category_detail", "category_evidence", "category_list", "category_pages",
    "category_run_history",
    "current_user_role",
    "dataset_ads_facets", "dataset_ads_page", "dataset_context", "dataset_list",
    "evergreen_threshold_days", "jsonb_text_array",
    "owned_ad_report_rows_valid",
    // Page Intelligence (0026) and its timeline (0027). Read-only, like every
    // function above them.
    "page_activity", "page_ads", "page_brand",
    // Compare (0029) projects the frozen page functions; it defines nothing.
    "page_compare_mix", "page_compare_summary", "page_compare_timeline",
    "page_creative_mix", "page_detail", "page_in_scope",
    "page_like_history", "page_list", "page_run_history", "page_run_mix",
    "page_scope_ads", "page_scope_observations", "page_timeline",
    "page_timeline_evidence", "run_collection_advance",
    "run_media_archive_drain",
    // What the collection asked for (0035). Reads what collection_runs has
    // stored since 0004; changes no count and no existing function.
    "scope_collection_filters",
    // Trends (0030). Read functions only; no cached trend, no stored value.
    "trend_context", "trend_evidence", "trend_mix", "trend_pages",
    "trend_state_scope", "trend_summary",
    // The Brand review queue (0033): a Page with no active mapping.
    "unmapped_pages",
    // Watchlist V1 (0032). Read functions plus one baseline write; no
    // evaluator, and nothing that runs on a schedule.
    "watch_scope_ads", "watchlist_list", "watchlist_reset_baseline",
    "watchlist_signal_evidence", "watchlist_signal_summary",
  ]);

  const allDown = files
    .filter((f) => f.endsWith(".down.sql"))
    .map(read)
    .join("\n");
  for (const fn of created) {
    assert.match(allDown, new RegExp(`drop function if exists public\\.${fn}`), `${fn} must be dropped`);
  }
});

test("RLS is enabled on all 13 tables", () => {
  const sql = read("0016_rls_policies.sql");
  const enabled = [...sql.matchAll(/alter table public\.(\w+)\s+enable row level security/g)];
  assert.equal(enabled.length, 13);
});

test("read functions are not left on Postgres defaults", () => {
  // Both halves matter: PUBLIC gets EXECUTE from Postgres itself, and Supabase
  // adds a per-role grant to anon that revoking from PUBLIC does not remove.
  const sql = read("0019_read_function_permissions.sql");
  assert.match(sql, /revoke all on function %s from public/);
  assert.match(sql, /revoke all on function %s from anon/);
  assert.match(sql, /revoke all on function public[.]current_user_role[(][)] from anon/);
  assert.match(sql, /grant execute on function %s to authenticated/);
  assert.match(sql, /alter function %s set search_path = public, pg_temp/);
  assert.doesNotMatch(sql, /security definer/i, "these must stay SECURITY INVOKER");
});

test("media_assets owns the observation, not the ad", () => {
  // Keying an archive by ad_archive_id would let a newer run overwrite the
  // creative an older dataset shows — invariant I1 broken through the media
  // layer instead of through the observation layer.
  const sql = read("0023_media_assets.sql");
  assert.match(sql, /ad_observation_id bigint not null\s+references public\.ad_observations\(id\)/);
  assert.doesNotMatch(sql, /references public\.ads\(/, "archives belong to observations");
  assert.match(sql, /unique \(ad_observation_id, asset_role\)/);
});

test("the archive status model keeps none and unusable apart", () => {
  const sql = read("0023_media_assets.sql");
  assert.match(sql, /check \(archive_status in \('pending', 'archived', 'none', 'unusable', 'failed'\)\)/);
});

test("media_assets has RLS with no client write policy", () => {
  const sql = read("0023_media_assets.sql");
  assert.match(sql, /alter table public\.media_assets enable row level security/);
  assert.match(sql, /create policy media_assets_read on public\.media_assets/);
  // Writes belong to the privileged archival path, which bypasses RLS. An
  // authenticated session must not be able to forge or repoint an archive row.
  assert.doesNotMatch(sql, /for (insert|update|delete) to authenticated/);
});

test("recreating a read function restores its grants", () => {
  // CREATE FUNCTION resets the ACL to the Postgres default, so 0024 has to
  // re-do 0019's work or it silently undoes it.
  const sql = read("0024_media_assets_read.sql");
  assert.match(sql, /revoke all on function %s from anon/);
  assert.match(sql, /grant execute on function %s to authenticated/);
  assert.match(sql, /must not be executable by anon/);
});


/**
 * A tick must finish inside the window that records its answer.
 *
 * Found in pilot: at ~1.6 seconds per asset on the hosted deployment, a batch of
 * 200 runs about five minutes while pg_net stops waiting at 120 seconds. The
 * archival still worked, but every loaded tick recorded a timeout instead of an
 * HTTP status — and net._http_response is the only thing that distinguishes a
 * healthy run from the C1.8 failure, where cron reported success while nothing
 * was delivered.
 *
 * The bound below is deliberately generous: it fails if somebody raises the
 * batch back into territory that cannot report on itself.
 */
test("one scheduled drain fits inside the pg_net timeout", () => {
  const scheduled = read("0034_media_archive_batch_size.sql");

  const limit = Number(/'limit',\s*(\d+)/.exec(scheduled)?.[1]);
  const timeoutMs = Number(/timeout_milliseconds\s*:=\s*(\d+)/.exec(scheduled)?.[1]);
  assert.ok(Number.isFinite(limit) && Number.isFinite(timeoutMs));

  const SECONDS_PER_ASSET = 1.6; // measured against the pilot deployment
  const budget = timeoutMs / 1000;
  assert.ok(
    limit * SECONDS_PER_ASSET < budget,
    `a batch of ${limit} needs ~${limit * SECONDS_PER_ASSET}s but pg_net waits ${budget}s`,
  );

  // The route's own ceiling has to be the larger of the two, or the function
  // would be killed mid-batch and leave claimed work behind.
  const route = readFileSync(join("app", "api", "media", "archive", "run", "route.ts"), "utf8");
  const maxDuration = Number(/maxDuration\s*=\s*(\d+)/.exec(route)?.[1]);
  assert.ok(maxDuration * 1000 >= timeoutMs, "maxDuration must cover the pg_net timeout");
});

test("the archive drain is scheduled and unreachable from an app role", () => {
  const sql = read("0025_media_archive_schedule.sql");
  assert.match(sql, /cron[.]schedule[(]\s*'media-archive-drain'/);
  // Ten minutes, because the window being raced is a ~105-hour signed URL and
  // the shortest one measured in a fresh export was 28 hours.
  assert.ok(sql.includes("'*/10 * * * *'"), "cadence must stay well inside the source lifetime");

  // SECURITY DEFINER plus Vault access would be an SSRF primitive if an
  // application session could invoke it.
  for (const role of ["public", "anon", "authenticated"]) {
    assert.ok(
      sql.includes(`revoke all on function public.run_media_archive_drain() from ${role}`),
      `${role} must not be able to execute the drain function`,
    );
  }

  // Credentials come from Vault, never from a file in the repository.
  assert.match(sql, /vault[.]decrypted_secrets/);
  assert.doesNotMatch(sql, /Bearer [A-Za-z0-9]{16}/, "no literal token in a migration");
});

test("collection advance is bounded and scheduled as a machine-only sweep", () => {
  const sql = read("0041_collection_advance_schedule.sql");
  const route = readFileSync(join("app", "api", "collections", "advance", "route.ts"), "utf8");

  assert.match(route, /export const maxDuration = 300/);
  assert.match(route, /after\(/, "work must continue after the 202 response");
  assert.match(route, /status:\s*202/, "the scheduler must acknowledge without waiting for a run");

  // The measured 1,000-record import from the approved spike is evidence for a
  // local bound only; production timing remains C16 work.
  const spike = readFileSync(join("docs", "SPIKE_2026-09-11_PROVIDER_EVIDENCE.md"), "utf8");
  const measuredLine = spike.split("\n").find((line) => line.includes("| 1,000 |"));
  const measuredImportSeconds = Number(measuredLine?.match(/\|\s*([\d.]+)\s*s\s*\|/)?.[1]);
  assert.ok(Number.isFinite(measuredImportSeconds), "the approved spike must record the 1,000-record import time");
  assert.ok(measuredImportSeconds < 300 * 0.8, "the local import bound must stay under 80% of maxDuration");

  assert.match(sql, /create function public\.run_collection_advance\(\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public, extensions, vault, pg_temp/);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /net\.http_post/);
  assert.match(sql, /collection_advance_url/);
  assert.match(sql, /collection_advance_token/);
  assert.match(sql, /collection_requests/);
  assert.match(sql, /no work due/);
  assert.ok(sql.includes("'* * * * *'"), "the advance sweep runs every minute");

  for (const role of ["public", "anon", "authenticated"]) {
    assert.ok(
      sql.includes(`revoke all on function public.run_collection_advance() from ${role}`),
      `${role} must not be able to execute the scheduler function`,
    );
  }
  assert.doesNotMatch(sql, /Bearer [A-Za-z0-9]{16}/, "no literal token in a migration");
});

test("only retryable failures are eligible to be claimed again", () => {
  const sql = read("0025_media_archive_schedule.sql");
  assert.match(sql, /add column if not exists failure_retryable boolean/);
  assert.match(sql, /where archive_status = 'pending'\s*\n\s*or \(archive_status = 'failed' and failure_retryable\)/);
});

/**
 * 0036 makes the API grants explicit. Applied to the running Pilot it must
 * change nothing, because the Pilot already holds every privilege it names —
 * they came from a platform default that current Supabase no longer applies.
 * So it may only ADD, and whatever it adds is written down, which is the only
 * way its rollback can take back exactly that and nothing the Pilot had before.
 */
test("0036 grants without revoking anything an API role already holds", () => {
  const up = read("0036_explicit_api_table_grants.sql");
  const down = read("0036_explicit_api_table_grants.down.sql");

  // No revoke may touch a product object. The only revokes allowed are the
  // ones that keep the ledger itself away from the API roles.
  for (const m of up.matchAll(/revoke[^;]*;/gi)) {
    assert.match(m[0], /migration_ledger/i, `0036 must not revoke on a product object: ${m[0]}`);
  }
  // anon is given nothing: no policy has ever let it read a row.
  assert.doesNotMatch(up, /'anon'/, "0036 must not grant anything to anon");
  // What it adds is recorded before it is granted, and the rollback reads the record.
  assert.match(up, /insert into migration_ledger\.grants/i);
  assert.match(down, /from migration_ledger\.grants/i);
  // The rollback revokes only what the ledger names — never a literal product object.
  assert.doesNotMatch(down, /revoke\s+[a-z, ]+\s+on\s+(table\s+|function\s+)?public\./i);
});

/**
 * 0038 names the identity conflict the state machine can actually meet, and
 * names nothing else: the taxonomy stays closed, and the two classes that mean
 * different failures keep their own meanings.
 */
test("0038 adds provider_identity_conflict and keeps the taxonomy closed", () => {
  const up = read("0038_provider_identity_conflict.sql");
  const down = read("0038_provider_identity_conflict.down.sql");
  const classesIn = (sql: string) => [...sql.matchAll(/'([a-z_]+)'(?=[\s,)])/g)].map((m) => m[1]);

  const before = [
    "provider_start_failed", "provider_unreachable", "provider_start_unknown",
    "provider_run_failed", "provider_timed_out", "provider_aborted",
    "provider_result_unsettled", "adapter_rejected", "export_too_large", "import_failed",
  ];
  const upClasses = classesIn(up.slice(up.indexOf("add constraint")));
  assert.deepEqual(upClasses, [
    "provider_start_failed", "provider_unreachable", "provider_start_unknown",
    "provider_identity_conflict",
    "provider_run_failed", "provider_timed_out", "provider_aborted",
    "provider_result_unsettled", "adapter_rejected", "export_too_large", "import_failed",
  ], "0038 adds exactly one class and drops none");

  // The constraint is replaced by name, so the check is not silently duplicated.
  assert.match(up, /drop constraint collection_requests_error_class_check/);
  assert.match(up, /add constraint collection_requests_error_class_check/);

  // The rollback restores exactly the pre-0038 list, and refuses while the new
  // class is in use rather than erasing why a request is waiting for an admin.
  assert.deepEqual(classesIn(down.slice(down.indexOf("add constraint"))), before);
  assert.match(down, /raise exception 'refusing to revert 0038/);

  // Nothing else moves: this is a CHECK, not a grant or a policy change.
  assert.doesNotMatch(up, /\b(grant|revoke|create policy|drop policy)\b/i);
});

/**
 * 0039 gives the finalization rule the one instant it needs. It must not touch
 * the amounts themselves, and it must not disturb cost_first_read_at, which
 * means something else: the first provider figure ever seen.
 */
test("0039 adds only the provisional observation instant", () => {
  const up = read("0039_cost_provisional_observed_at.sql");
  const down = read("0039_cost_provisional_observed_at.down.sql");

  assert.match(up, /add column cost_provisional_observed_at timestamptz/);
  // One added column, and no existing column altered — cost_first_read_at keeps
  // its own meaning.
  assert.equal(up.match(/add column/g)?.length, 1);
  assert.doesNotMatch(up, /alter column|drop column|set default/i);
  // The amount and its instant exist together or not at all.
  assert.match(up, /\(cost_provisional_usd is null\) = \(cost_provisional_observed_at is null\)/);
  // Additive only: no data is rewritten and no other column changes.
  assert.doesNotMatch(up, /(update|delete|drop column|grant|revoke)/i);
  // The rollback removes exactly what it added.
  assert.match(down, /drop constraint collection_requests_provisional_observed/);
  assert.match(down, /drop column cost_provisional_observed_at/);
});

/**
 * 0040 exists so an admin can reopen a cost window that is, by definition,
 * already spent. It must stay scheduling state: additive, run-gated, and
 * nothing an automatic path would write.
 */
test("0040 adds the admin settlement and cost-window reopen instants", () => {
  const up = read("0040_cost_window_reopen.sql");
  const down = read("0040_cost_window_reopen.down.sql");

  assert.match(up, /add column result_settle_reopened_at timestamptz/);
  assert.match(up, /add column cost_window_reopened_at timestamptz/);
  assert.equal(up.match(/add column/g)?.length, 2);
  assert.doesNotMatch(up, /alter column|drop column|set default/i);
  assert.match(up, /result_settle_reopened_at is null or provider_dataset_id is not null/);
  // Reopening means asking about a run, so there has to be one.
  assert.match(up, /cost_window_reopened_at is null or provider_run_id is not null/);
  assert.doesNotMatch(up, /(update|delete|grant|revoke)/i);
  assert.match(down, /drop constraint collection_requests_result_reopen_needs_dataset/);
  assert.match(down, /drop constraint collection_requests_cost_reopen_needs_run/);
  assert.match(down, /drop column result_settle_reopened_at/);
  assert.match(down, /drop column cost_window_reopened_at/);
});
