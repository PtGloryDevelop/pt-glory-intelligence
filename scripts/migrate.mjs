#!/usr/bin/env node
/**
 * Applies or rolls back supabase/migrations against DATABASE_URL.
 *
 *   node scripts/migrate.mjs up          apply every pending migration
 *   node scripts/migrate.mjs down        roll back the newest applied migration
 *   node scripts/migrate.mjs down --all  roll back everything, newest first
 *
 * Each migration runs inside its own transaction, so a failure leaves the
 * database on the last good version instead of half-applied.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const DIR = join(process.cwd(), "supabase", "migrations");
const command = process.argv[2] ?? "up";
const all = process.argv.includes("--all");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. It is server-only; never commit it.");
  process.exit(1);
}

const upFiles = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
  .sort();

const client = new pg.Client({ connectionString });
await client.connect();

await client.query(`
  create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )
`);

const { rows } = await client.query("select version from public.schema_migrations");
const applied = new Set(rows.map((r) => r.version));

try {
  if (command === "up") {
    const pending = upFiles.filter((f) => !applied.has(f));
    if (pending.length === 0) console.log("nothing to apply");
    for (const file of pending) {
      await runInTransaction(file, readFileSync(join(DIR, file), "utf8"), "insert");
      console.log(`applied ${file}`);
    }
  } else if (command === "down") {
    const targets = upFiles.filter((f) => applied.has(f)).reverse();
    const list = all ? targets : targets.slice(0, 1);
    if (list.length === 0) console.log("nothing to roll back");
    for (const file of list) {
      const down = file.replace(/\.sql$/, ".down.sql");
      await runInTransaction(file, readFileSync(join(DIR, down), "utf8"), "delete");
      console.log(`rolled back ${file}`);
    }
  } else {
    console.error(`unknown command: ${command}`);
    process.exitCode = 1;
  }
} finally {
  await client.end();
}

async function runInTransaction(version, sql, mode) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      mode === "insert"
        ? "insert into public.schema_migrations (version) values ($1)"
        : "delete from public.schema_migrations where version = $1",
      [version],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`${version} failed: ${error.message}`, { cause: error });
  }
}
