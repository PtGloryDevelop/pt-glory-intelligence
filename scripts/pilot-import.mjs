/**
 * Imports a real collector export into the PILOT database.
 *
 *   PT_GLORY_ENV=pilot node --env-file-if-exists=.env.local --conditions=react-server \
 *     --experimental-strip-types scripts/pilot-import.mjs <export.json> <category> <dataset name>
 *
 * Same three steps the HTTP route performs, in the same order and with the same
 * functions — validate and normalize, commit in one transaction, then enqueue
 * the media on a separate connection so an archival problem can never roll back
 * a dataset that imported correctly.
 *
 * What it does NOT do is drain the queue. That is the scheduler's job now, and
 * draining by hand here would hide whether automatic archival actually works.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { validate } from "../lib/collector/validate.ts";
import { normalize } from "../lib/collector/normalize.ts";
import { commitImport } from "../lib/import/commit.ts";
import { enqueueRun } from "../lib/media/archive.ts";
import { closePool } from "../lib/db/privileged.ts";
import { isPilotProject } from "./destructive-guard.mjs";

const [, , file, categoryName, datasetName] = process.argv;
if (!file || !categoryName || !datasetName) {
  console.error("usage: pilot-import.mjs <export.json> <category name> <dataset name>");
  process.exit(1);
}
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

// The importing actor is a real account with a real role, not a synthetic id:
// audit_logs records who did this, and "nobody" is not an answer.
const { rows: actors } = await client.query(
  "select user_id from public.user_roles where role in ('analyst','admin') order by created_at limit 1",
);
if (!actors[0]) {
  console.error("refused: no analyst or admin account exists to attribute this import to");
  process.exit(1);
}
const actorId = actors[0].user_id;

const { rows: categories } = await client.query(
  `insert into public.categories (name) values ($1)
   on conflict (name) do update set name = excluded.name
   returning id, name`,
  [categoryName],
);
const categoryId = categories[0].id;
console.log(`category: ${categories[0].name} (${categoryId})`);

/*
 * validate + normalize rather than previewImport: the preview also reports how
 * much of the file the database has already seen, which it reads through the
 * request-scoped Supabase client — there is no request here. The validation
 * that decides whether a file may be committed is identical.
 */
const checked = validate(JSON.parse(readFileSync(file, "utf8")));
if (!checked.ok) {
  console.error(`refused by validation: ${checked.reason}`, checked.detail ?? "");
  process.exit(1);
}
const canonical = normalize(checked.file);
console.log("validation: ok", JSON.stringify(canonical.run.computed));

const result = await commitImport({ canonical, categoryId, datasetName, actorId });
console.log("committed:", JSON.stringify(result));

// Separate connection, after the transaction, exactly as the route does it.
const queued = await enqueueRun(result.collectionRunId);
console.log("media queued:", JSON.stringify(queued));

const { rows: health } = await client.query(
  `select archive_status, count(*)::int n from public.media_assets group by 1 order by 1`,
);
console.log("media queue now:", JSON.stringify(health));
const { rows: expiry } = await client.query(
  `select min(source_expires_at) earliest, max(source_expires_at) latest
     from public.media_assets where archive_status = 'pending'`,
);
console.log("pending source URLs expire between:", JSON.stringify(expiry[0]));

await client.end();
await closePool();
