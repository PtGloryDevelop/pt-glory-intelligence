/**
 * Puts the scheduler's credentials into Supabase Vault.
 *
 * Run once per environment, and again after rotating the token. Reads both
 * values from the environment so nothing secret is typed on a command line or
 * written to a file in the repo.
 *
 *   MEDIA_ARCHIVE_URL=https://app.example \
 *   node --env-file-if-exists=.env.local scripts/archive-schedule-config.mjs
 *
 * MEDIA_ARCHIVE_TOKEN must match what the app verifies. Nothing here prints it.
 */
import pg from "pg";

const url = process.env.MEDIA_ARCHIVE_URL;
const token = process.env.MEDIA_ARCHIVE_TOKEN;

if (!url || !token) {
  console.error("MEDIA_ARCHIVE_URL and MEDIA_ARCHIVE_TOKEN must both be set");
  process.exit(1);
}
if (token.length < 16) {
  console.error("MEDIA_ARCHIVE_TOKEN is too short to be a credential");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

/** Vault has no upsert; replacing means removing the old secret by name first. */
async function setSecret(name, value) {
  await client.query("select vault.create_secret($1, $2) where not exists (select 1 from vault.secrets where name = $2)", [value, name])
    .catch(() => {});
  const { rows } = await client.query("select id from vault.secrets where name = $1", [name]);
  if (rows.length === 0) {
    await client.query("select vault.create_secret($1, $2)", [value, name]);
  } else {
    await client.query("select vault.update_secret($1, $2)", [rows[0].id, value]);
  }
}

await setSecret("media_archive_url", url.replace(/\/+$/, ""));
await setSecret("media_archive_token", token);

const { rows } = await client.query(
  "select name, created_at from vault.secrets where name in ('media_archive_url','media_archive_token') order by name",
);
for (const row of rows) console.log(`configured ${row.name}`);

const job = await client.query("select jobname, schedule, active from cron.job where jobname = 'media-archive-drain'");
console.log("schedule:", JSON.stringify(job.rows[0] ?? null));
await client.end();
