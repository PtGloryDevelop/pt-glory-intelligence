/**
 * Empties the PILOT database before real usage begins.
 *
 * This is the deliberate opposite of scripts/destructive-guard.mjs. That guard
 * refuses the Cloud project so a test run can never touch it; this script
 * refuses *anything else*, so a one-off cleanup can never land on a developer's
 * local database or another project by accident. Two scripts, two refusals,
 * neither able to do the other's job.
 *
 * It removes data, never schema: migrations and app_settings survive, because
 * the environment has to stay reproducible from the repository and the two
 * configuration rows are system state rather than research data.
 *
 *   PT_GLORY_ENV=pilot PILOT_RESET_CONFIRM=<project-ref> \
 *     node --env-file-if-exists=.env.local scripts/pilot-reset.mjs
 *
 * The confirmation is the project ref typed by hand. A flag like --yes would be
 * one arrow-up away in a shell; a ref has to be looked up and read.
 */
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { describeTarget, isPilotProject, PILOT_PROJECT_REF } from "./destructive-guard.mjs";

const connectionString = process.env.DATABASE_URL;
const target = describeTarget(connectionString);

function refuse(reason) {
  console.error(`pilot reset refused against ${target.label}: ${reason}`);
  process.exit(1);
}

if ((process.env.PT_GLORY_ENV ?? "").toLowerCase() !== "pilot") {
  refuse("PT_GLORY_ENV=pilot is not set");
}
if (!isPilotProject(connectionString)) {
  // The inverse guard: this script exists for one database and refuses the rest.
  refuse(`this is not the pilot project (${PILOT_PROJECT_REF})`);
}
if (process.env.PILOT_RESET_CONFIRM !== PILOT_PROJECT_REF) {
  refuse(`PILOT_RESET_CONFIRM must be the project ref, typed out`);
}

/** Data tables, in an order that reads clearly; the truncate cascades anyway. */
const DATA_TABLES = [
  "audit_logs", "import_quarantine", "dataset_quality", "dataset_ads",
  "media_assets", "ad_observations", "ads", "page_observations", "pages",
  "watch_items", "brand_page_mappings", "brands",
  "datasets", "collection_runs", "categories",
];

const client = new pg.Client({ connectionString });
await client.connect();

async function inventory(label) {
  const counts = {};
  for (const table of [...DATA_TABLES, "app_settings", "schema_migrations"]) {
    const { rows } = await client.query(`select count(*)::int n from public.${table}`);
    counts[table] = rows[0].n;
  }
  const { rows: users } = await client.query("select count(*)::int n from auth.users");
  counts["auth.users"] = users[0].n;
  console.log(`\n--- ${label} ---`);
  console.table(counts);
  return counts;
}

const before = await inventory("before");

try {
  await client.query("begin");
  // One statement so no foreign key can be left dangling mid-way.
  await client.query(`truncate table ${DATA_TABLES.map((t) => `public.${t}`).join(", ")} restart identity cascade`);
  // Roles hang off auth.users by cascade, so the accounts go with them.
  await client.query("delete from auth.users");
  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  throw error;
}

const after = await inventory("after");
await client.end();

/*
 * Archived previews belong to observations that no longer exist. Leaving them
 * would keep test imagery in a bucket the pilot is about to fill with real
 * creative, where nothing on screen would say which was which.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (url && serviceKey) {
  const storage = createClient(url, serviceKey, { auth: { persistSession: false } }).storage;
  const bucket = "pt-glory-media-previews";
  const { data: exists } = await storage.getBucket(bucket);
  if (!exists) {
    console.log(`\nstorage: bucket ${bucket} does not exist yet — nothing to clear`);
  } else {
    let removed = 0;
    // The bucket is one flat level of run folders; list each and remove in bulk.
    const { data: folders } = await storage.from(bucket).list("", { limit: 1000 });
    for (const folder of folders ?? []) {
      const { data: files } = await storage.from(bucket).list(folder.name, { limit: 1000 });
      const paths = (files ?? []).map((file) => `${folder.name}/${file.name}`);
      if (paths.length === 0) continue;
      const { error } = await storage.from(bucket).remove(paths);
      if (error) throw error;
      removed += paths.length;
    }
    console.log(`\nstorage: removed ${removed} archived preview object(s) from ${bucket}`);
  }
} else {
  console.log("\nstorage: no service credentials in this shell — bucket left untouched");
}

const remaining = Object.entries(after).filter(([table, n]) =>
  n > 0 && table !== "app_settings" && table !== "schema_migrations");
console.log(
  remaining.length === 0
    ? `\npilot database is empty of research data. Kept: ${after.app_settings} app_settings row(s), ` +
      `${after.schema_migrations} applied migration(s).`
    : `\nWARNING: rows remain in ${remaining.map(([t]) => t).join(", ")}`,
);
console.log(`removed ${before["auth.users"]} account(s), ${before.ads} ad(s), ${before.pages} page(s).`);
