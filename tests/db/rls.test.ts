import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

/**
 * RLS matrix against a real database.
 *
 * Requires DATABASE_URL pointing at a database with migrations 0001-0016 applied
 * (`node scripts/migrate.mjs up`). Skipped when it is absent so the default test
 * run stays offline.
 *
 * Each case impersonates a role the way PostgREST does: set the `authenticated`
 * role and a request JWT claim carrying the user id, then check what the policies
 * actually allow.
 */
const connectionString = process.env.DATABASE_URL;
const skip = connectionString ? false : "DATABASE_URL not set";

const READ_TABLES = [
  "categories", "collection_runs", "datasets", "pages", "page_observations",
  "ads", "ad_observations", "dataset_ads", "dataset_quality", "import_quarantine",
] as const;

type Role = "viewer" | "analyst" | "admin";

async function withUser<T>(
  client: pg.Client,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    return await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

async function seedUser(client: pg.Client, role: Role): Promise<string> {
  const { rows } = await client.query(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`rls-${role}-${Date.now()}@example.test`],
  );
  const id = rows[0].id as string;
  await client.query("insert into public.user_roles (user_id, role) values ($1, $2)", [id, role]);
  return id;
}

test("RLS matrix", { skip }, async (t) => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  t.after(() => client.end());

  const viewer = await seedUser(client, "viewer");
  const analyst = await seedUser(client, "analyst");
  const admin = await seedUser(client, "admin");

  await t.test("viewer can read business tables", async () => {
    await withUser(client, viewer, async () => {
      for (const table of READ_TABLES) {
        await client.query(`select 1 from public.${table} limit 1`);
      }
    });
  });

  await t.test("viewer cannot insert into business tables", async () => {
    await withUser(client, viewer, async () => {
      await assert.rejects(
        () => client.query("insert into public.categories (name) values ('viewer-should-fail')"),
        /row-level security/i,
      );
    });
  });

  await t.test("analyst can insert a category", async () => {
    await withUser(client, analyst, async () => {
      await client.query("insert into public.categories (name) values ('analyst-ok')");
    });
  });

  await t.test("analyst cannot read app_settings or audit_logs", async () => {
    await withUser(client, analyst, async () => {
      const settings = await client.query("select * from public.app_settings");
      assert.equal(settings.rowCount, 0, "app_settings must be admin-only");
      const logs = await client.query("select * from public.audit_logs");
      assert.equal(logs.rowCount, 0, "audit_logs must be admin-only");
    });
  });

  await t.test("admin can read app_settings", async () => {
    await withUser(client, admin, async () => {
      const { rowCount } = await client.query("select * from public.app_settings");
      assert.ok((rowCount ?? 0) > 0, "seeded settings should be visible to admin");
    });
  });

  await t.test("nobody can change their own role", async () => {
    for (const [label, id] of [["viewer", viewer], ["analyst", analyst], ["admin", admin]] as const) {
      await withUser(client, id, async () => {
        const { rowCount } = await client.query(
          "update public.user_roles set role = 'admin' where user_id = $1",
          [id],
        );
        assert.equal(rowCount, 0, `${label} must not be able to self-promote`);
      });
    }
  });

  await t.test("admin can grant a role to someone else", async () => {
    await withUser(client, admin, async () => {
      const { rowCount } = await client.query(
        "update public.user_roles set role = 'analyst' where user_id = $1",
        [viewer],
      );
      assert.equal(rowCount, 1);
    });
  });

  await t.test("privileged connection bypasses RLS", async () => {
    // Proves the Node-side requireRole() check is the only guard on the write
    // path — RLS does not protect anything there.
    const { rowCount } = await client.query("select * from public.app_settings");
    assert.ok((rowCount ?? 0) > 0, "owner connection should see admin-only rows");
  });

  await t.test("soft-deleted rows disappear from reads", async () => {
    const { rows } = await client.query(
      "insert into public.categories (name, deleted_at) values ($1, now()) returning id",
      [`deleted-${Date.now()}`],
    );
    await withUser(client, viewer, async () => {
      const seen = await client.query("select 1 from public.categories where id = $1", [rows[0].id]);
      assert.equal(seen.rowCount, 0);
    });
    await client.query("delete from public.categories where id = $1", [rows[0].id]);
  });
});
