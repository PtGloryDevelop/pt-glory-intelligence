/**
 * Stores the collection advance URL and machine token in Supabase Vault.
 *
 *   COLLECTION_ADVANCE_URL=https://app.example \
 *   COLLECTION_ADVANCE_TOKEN=... \
 *   node --env-file-if-exists=.env.local scripts/collection-schedule-config.mjs
 *
 * The token is never printed. Configure each environment separately; the
 * migration itself is a no-op until both Vault values and tick_batch exist.
 */
import pg from "pg";

const url = process.env.COLLECTION_ADVANCE_URL;
const token = process.env.COLLECTION_ADVANCE_TOKEN;

if (!url || !token) {
  console.error("COLLECTION_ADVANCE_URL and COLLECTION_ADVANCE_TOKEN must both be set");
  process.exit(1);
}
if (token.length < 16) {
  console.error("COLLECTION_ADVANCE_TOKEN is too short to be a credential");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

/** Vault has no upsert; replace the value while preserving its name. */
async function setSecret(name, value) {
  const { rows } = await client.query("select id from vault.secrets where name = $1", [name]);
  if (rows.length === 0) await client.query("select vault.create_secret($1, $2)", [value, name]);
  else await client.query("select vault.update_secret($1, $2)", [rows[0].id, value]);
}

await setSecret("collection_advance_url", url.replace(/\/+$/, ""));
await setSecret("collection_advance_token", token);

const { rows } = await client.query(
  "select name, created_at from vault.secrets where name in ('collection_advance_url','collection_advance_token') order by name",
);
for (const row of rows) console.log(`configured ${row.name}`);

const job = await client.query(
  "select jobname, schedule, active from cron.job where jobname = 'collection-advance'",
);
console.log("schedule:", JSON.stringify(job.rows[0] ?? null));
await client.end();
