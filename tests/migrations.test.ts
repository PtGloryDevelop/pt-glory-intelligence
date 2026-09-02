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

test("migrations are numbered 0001..0020 with no gaps", () => {
  const numbers = up.map((f) => Number(f.slice(0, 4)));
  assert.deepEqual(numbers, Array.from({ length: 20 }, (_, i) => i + 1));
});

test("all 13 tables are created", () => {
  const expected = [
    "user_roles", "categories", "collection_runs", "datasets", "pages",
    "page_observations", "ads", "ad_observations", "dataset_ads",
    "dataset_quality", "import_quarantine", "app_settings", "audit_logs",
  ];
  for (const table of expected) {
    assert.match(allUp, new RegExp(`create table public\\.${table}\\b`), `missing ${table}`);
  }
  const created = [...allUp.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
  assert.equal(created.length, 13, `expected 13 tables, found ${created.length}`);
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

test("collection_method enum holds the three known collectors", () => {
  assert.match(
    read("0004_collection_runs.sql"),
    /'network_response_observation','user_initiated_dom_observation','socialapis_api'/,
  );
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
  const created = [...allUp.matchAll(/create function public\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(created, ["ad_detail", "ad_observation_history", "current_user_role", "dataset_ads_facets", "dataset_ads_page", "dataset_context", "dataset_list", "jsonb_text_array"]);

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
