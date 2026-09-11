import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "./helpers.ts";

/**
 * The API privilege model 0036 wrote down, asserted against the database.
 *
 * Until 0036 the schema only worked on a Supabase project old enough to
 * auto-grant every new table to every API role. These cases pin the model that
 * replaced that default, so a fresh project and the running Pilot agree on
 * everything a policy actually uses:
 *
 *   authenticated  exactly the commands its RLS policies cover — no more, so a
 *                  table grant never becomes a way around a missing policy
 *   anon           no table privilege at all
 *   service_role   only what code uses today
 *
 * TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are not asserted here: current
 * Supabase still hands them to every API role by default, 0036 neither adds
 * nor removes them, and taking them away would change the Pilot.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

/**
 * Every product table. A new one must be added here, which forces a decision
 * about its grants instead of inheriting whatever the platform default is.
 */
const PRODUCT_TABLES = [
  "ad_observations", "ads", "app_settings", "audit_logs", "brand_page_mappings",
  "brands", "categories", "collection_runs", "dataset_ads", "dataset_quality",
  "datasets", "import_quarantine", "media_assets", "page_observations", "pages",
  "user_roles", "watch_items",
].sort();

const COMMANDS = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;
const POLICY_COMMANDS: Record<string, readonly string[]> = {
  SELECT: ["SELECT"], INSERT: ["INSERT"], UPDATE: ["UPDATE"], DELETE: ["DELETE"], ALL: COMMANDS,
};

/** service_role's whole reach, and the code that needs each part. */
const SERVICE_ROLE: Record<string, string[]> = {
  user_roles: ["INSERT"],                     // auth-chain seeds a role row
  categories: ["SELECT", "INSERT", "DELETE"], // auth-chain seeds and removes a category
};

test("the API roles reach exactly what the policies use", { skip }, async (t) => {
  const client = await connect();
  t.after(() => client.end());

  async function held(role: string, table: string): Promise<string[]> {
    const out: string[] = [];
    for (const command of COMMANDS) {
      const { rows } = await client.query<{ x: boolean }>(
        "select has_table_privilege($1, $2, $3) as x", [role, `public.${table}`, command],
      );
      if (rows[0].x) out.push(command);
    }
    return out;
  }

  await t.test("every product table is declared, and nothing else is", async () => {
    const { rows } = await client.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'schema_migrations'
        order by 1`,
    );
    assert.deepEqual(rows.map((r) => r.relname), PRODUCT_TABLES);
  });

  await t.test("authenticated holds exactly the commands its policies cover", async () => {
    for (const table of PRODUCT_TABLES) {
      const { rows } = await client.query<{ cmd: string }>(
        `select cmd from pg_policies
          where schemaname = 'public' and tablename = $1
            and (roles @> array['authenticated']::name[] or roles @> array['public']::name[])`,
        [table],
      );
      const expected = COMMANDS.filter((c) => rows.some((r) => POLICY_COMMANDS[r.cmd]?.includes(c)));
      assert.ok(expected.length > 0, `${table} has no policy for authenticated`);
      assert.deepEqual(await held("authenticated", table), expected, `authenticated on ${table}`);
    }
  });

  await t.test("anon holds no table privilege a query could use", async () => {
    for (const table of PRODUCT_TABLES) {
      assert.deepEqual(await held("anon", table), [], `anon on ${table}`);
    }
  });

  await t.test("service_role holds only what code uses", async () => {
    for (const table of PRODUCT_TABLES) {
      assert.deepEqual(await held("service_role", table), SERVICE_ROLE[table] ?? [], `service_role on ${table}`);
    }
  });

  await t.test("jsonb_text_array is executable by authenticated and never by anon", async () => {
    const { rows } = await client.query<{ auth: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated', 'public.jsonb_text_array(jsonb)', 'execute') as auth,
              has_function_privilege('anon', 'public.jsonb_text_array(jsonb)', 'execute') as anon`,
    );
    assert.equal(rows[0].auth, true);
    assert.equal(rows[0].anon, false);
  });

  await t.test("the grant ledger is out of reach of every API role", async () => {
    const { rows } = await client.query<{ exists: boolean }>(
      "select to_regnamespace('migration_ledger') is not null as exists",
    );
    // A fresh install records what 0036 added; the ledger must exist there.
    assert.equal(rows[0].exists, true, "0036 should have left its ledger");
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows: usage } = await client.query<{ x: boolean }>(
        "select has_schema_privilege($1, 'migration_ledger', 'usage') as x", [role],
      );
      assert.equal(usage[0].x, false, `${role} must not reach migration_ledger`);
    }
  });
});
