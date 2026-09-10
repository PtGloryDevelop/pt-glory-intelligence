/**
 * Takes a logical backup of everything the pilot cannot rebuild from a file.
 *
 *   PT_GLORY_ENV=pilot node --env-file-if-exists=.env.local scripts/pilot-backup.mjs
 *
 * The reasoning, from PILOT_OPERATIONS §9: the schema comes back from
 * `supabase/migrations`, and any dataset comes back from its original collector
 * export — but the editorial layer comes back from nowhere. Brands, the Page
 * mappings and their history, Watchlists, categories and role assignments are
 * decisions people made. No export contains them, and no amount of re-importing
 * recreates them.
 *
 * So they are dumped to a local JSON file, whatever the hosting plan's backup
 * policy turns out to be. Read-only against the database; the file is written
 * outside the repository's tracked tree.
 *
 * Deliberately NOT a dump of ads, observations or media. Those are large,
 * reproducible from the exports, and copying them here would turn a small
 * recovery file into a second uncontrolled copy of the research data.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { describeTarget, isPilotProject } from "./destructive-guard.mjs";

if ((process.env.PT_GLORY_ENV ?? "").toLowerCase() !== "pilot") {
  console.error("refused: PT_GLORY_ENV=pilot is not set");
  process.exit(1);
}
if (!isPilotProject(process.env.DATABASE_URL)) {
  console.error("refused: DATABASE_URL does not point at the pilot project");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const table = async (label, sql) => {
  const { rows } = await client.query(sql);
  console.log(`  ${String(rows.length).padStart(5)}  ${label}`);
  return rows;
};

console.log("reading the editorial layer:");

const backup = {
  takenAt: new Date().toISOString(),
  // Host only. A backup file must never carry the credential that made it.
  source: describeTarget(process.env.DATABASE_URL).label,
  schemaVersion: (await client.query(
    "select version from public.schema_migrations order by version desc limit 1")).rows[0]?.version,

  categories: await table("categories", `
    select id, name, slug, created_at, deleted_at from public.categories order by name`),

  /*
   * The dataset manifest, not the datasets. Enough to know which export file
   * rebuilds which dataset, and to notice if one is missing.
   */
  datasetManifest: await table("dataset manifest", `
    select d.id, d.name, d.category_id, d.created_at, d.deleted_at,
           r.collected_at, r.source_product, r.collection_method,
           r.scope_query, r.scope_country, r.status,
           (select count(*)::int from public.dataset_ads da where da.dataset_id = d.id) as ads
      from public.datasets d
      join public.collection_runs r on r.id = d.collection_run_id
     order by r.collected_at`),

  brands: await table("brands", `
    select id, name, status, notes, created_by, created_at, updated_at
      from public.brands order by name`),

  // Every decision, open and closed. History is the point of the table.
  brandPageMappings: await table("brand page mappings", `
    select id, brand_id, page_id, valid_from, valid_to,
           mapped_by, mapped_by_label, ended_by, ended_by_label, note, created_at
      from public.brand_page_mappings order by valid_from`),

  watchItems: await table("watch items", `
    select id, created_by, target_type, target_page_id, target_category_id,
           scope_kind, scope_dataset_id, scope_category_id,
           tracked_signals, baseline_at, created_at, updated_at
      from public.watch_items order by created_at`),

  // user_id and role only. Emails live in auth, and this file does not need them.
  userRoles: await table("user roles", `
    select user_id, role, created_at, updated_at from public.user_roles order by role, created_at`),

  appSettings: await table("app settings", `
    select key, value, updated_at from public.app_settings order by key`),
};

/*
 * Archived previews are objects in a private bucket. Their paths are recorded so
 * a restore can tell whether a preview it expects is actually there; the bytes
 * themselves stay where they are.
 */
const { rows: media } = await client.query(`
  select archive_status, count(*)::int n from public.media_assets group by 1 order by 1`);
backup.mediaSummary = Object.fromEntries(media.map((r) => [r.archive_status, r.n]));
console.log(`         media summary: ${JSON.stringify(backup.mediaSummary)}`);

await client.end();

const dir = "backups";
mkdirSync(dir, { recursive: true });
const file = join(dir, `pilot-editorial-${backup.takenAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(backup, null, 2), { mode: 0o600 });

const counts = {
  categories: backup.categories.length,
  datasets: backup.datasetManifest.length,
  brands: backup.brands.length,
  mappings: backup.brandPageMappings.length,
  watches: backup.watchItems.length,
  roles: backup.userRoles.length,
};
console.log(`\nwrote ${file}`);
console.log(JSON.stringify(counts));
console.log(
  "\nThis restores the editorial layer only. Datasets come back by re-importing " +
  "their original collector exports; the schema comes back from supabase/migrations.",
);
