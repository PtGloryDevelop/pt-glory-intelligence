#!/usr/bin/env node
/**
 * Gate A final verification, in the exact order the review asked for:
 *
 *   1. migrate up 0001-0016 on a clean database
 *   2. npm run test:db
 *   3. migrate down --all
 *   4. assert the rollback left nothing behind
 *   5. migrate up again
 *   6. npm run test:db again
 *
 * Step 4 is the one that catches a lazy down-migration: it fails if any project
 * table, the helper function, or a leftover policy survived the rollback.
 */
import { spawnSync } from "node:child_process";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  console.error("Start a local stack with `supabase start`, then export its DB URL.");
  process.exit(1);
}

const TABLES = [
  "user_roles", "categories", "collection_runs", "datasets", "pages",
  "page_observations", "ads", "ad_observations", "dataset_ads",
  "dataset_quality", "import_quarantine", "app_settings", "audit_logs",
];

function run(label, command, args) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`\nFAILED: ${label}`);
    process.exit(result.status ?? 1);
  }
}

async function assertCleanRollback() {
  process.stdout.write("\n=== 4. verify rollback is clean ===\n");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows: tables } = await client.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1)`,
      [TABLES],
    );
    const { rows: fns } = await client.query(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname = 'current_user_role'`,
    );
    const { rows: policies } = await client.query(
      `select tablename, policyname from pg_policies
        where schemaname = 'public' and tablename = any($1)`,
      [TABLES],
    );

    const problems = [
      ...tables.map((r) => `table still present: ${r.table_name}`),
      ...fns.map((r) => `function still present: ${r.proname}`),
      ...policies.map((r) => `policy still present: ${r.tablename}.${r.policyname}`),
    ];

    if (problems.length > 0) {
      for (const problem of problems) console.error(`  ${problem}`);
      throw new Error(`rollback left ${problems.length} object(s) behind`);
    }
    console.log("  clean: no project tables, functions or policies remain");
  } finally {
    await client.end();
  }
}

run("1. migrate up", "node", ["scripts/migrate.mjs", "up"]);
run("2. test:db", "npm", ["run", "test:db"]);
run("3. migrate down --all", "node", ["scripts/migrate.mjs", "down", "--all"]);
await assertCleanRollback();
run("5. migrate up again", "node", ["scripts/migrate.mjs", "up"]);
run("6. test:db again", "npm", ["run", "test:db"]);

console.log("\nGate A final verification passed.");
