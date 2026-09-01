import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

/**
 * RLS matrix against a real PostgreSQL database.
 *
 * Requires DATABASE_URL with migrations 0001-0016 applied
 * (`npm run migrate up`). Skipped when absent so the default run stays offline.
 *
 * Each case impersonates a caller the way PostgREST does: switch to the
 * `authenticated` role and set the `request.jwt.claims` GUC. `auth.uid()` reads
 * `sub` out of that claim, so this exercises the same path a real request takes.
 */
const connectionString = process.env.DATABASE_URL;
const skip = connectionString ? false : "DATABASE_URL not set";

const READ_TABLES = [
  "categories", "collection_runs", "datasets", "pages", "page_observations",
  "ads", "ad_observations", "dataset_ads", "dataset_quality", "import_quarantine",
] as const;

type Role = "viewer" | "analyst" | "admin";

/** Runs `fn` as the given user, then rolls back so cases stay isolated. */
async function asUser<T>(client: pg.Client, userId: string, fn: () => Promise<T>): Promise<T> {
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

/** Anonymous caller: the `anon` role with no JWT claims at all. */
async function asAnon<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("set local role anon");
    return await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

async function seedUser(client: pg.Client, role: Role | null, tag: string): Promise<string> {
  const { rows } = await client.query(
    "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
    [`rls-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`],
  );
  const id = rows[0].id as string;
  if (role) {
    await client.query("insert into public.user_roles (user_id, role) values ($1, $2)", [id, role]);
  }
  return id;
}

test("RLS matrix", { skip }, async (t) => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  t.after(() => client.end());

  const viewer = await seedUser(client, "viewer", "viewer");
  const analyst = await seedUser(client, "analyst", "analyst");
  const admin = await seedUser(client, "admin", "admin");
  const roleless = await seedUser(client, null, "noRole");

  // A row every read case can look for.
  const seededCategory = `rls-seed-${Date.now()}`;
  await client.query("insert into public.categories (name) values ($1)", [seededCategory]);
  t.after(() => client.query("delete from public.categories where name = $1", [seededCategory]));

  await t.test("unauthenticated sees nothing", async () => {
    await asAnon(client, async () => {
      for (const table of READ_TABLES) {
        const { rowCount } = await client.query(`select * from public.${table}`);
        assert.equal(rowCount, 0, `anon must not read ${table}`);
      }
    });
  });

  await t.test("unauthenticated cannot write", async () => {
    await asAnon(client, async () => {
      await assert.rejects(
        () => client.query("insert into public.categories (name) values ('anon-should-fail')"),
        /row-level security|permission denied/i,
      );
    });
  });

  await t.test("authenticated without a user_roles row is denied", async () => {
    await asUser(client, roleless, async () => {
      for (const table of READ_TABLES) {
        const { rowCount } = await client.query(`select * from public.${table}`);
        assert.equal(rowCount, 0, `a roleless account must not read ${table}`);
      }
      await assert.rejects(
        () => client.query("insert into public.categories (name) values ('norole-should-fail')"),
        /row-level security/i,
      );
    });
  });

  await t.test("viewer reads every business table", async () => {
    await asUser(client, viewer, async () => {
      const { rowCount } = await client.query("select * from public.categories where name = $1", [
        seededCategory,
      ]);
      assert.equal(rowCount, 1);
      for (const table of READ_TABLES) await client.query(`select * from public.${table}`);
    });
  });

  await t.test("viewer cannot insert, update or delete", async () => {
    await asUser(client, viewer, async () => {
      await assert.rejects(
        () => client.query("insert into public.categories (name) values ('viewer-should-fail')"),
        /row-level security/i,
      );
      const updated = await client.query("update public.categories set slug = 'x' where name = $1", [
        seededCategory,
      ]);
      assert.equal(updated.rowCount, 0, "viewer update must affect no rows");
      const deleted = await client.query("delete from public.categories where name = $1", [
        seededCategory,
      ]);
      assert.equal(deleted.rowCount, 0, "viewer delete must affect no rows");
    });
  });

  await t.test("analyst can insert but cannot delete", async () => {
    await asUser(client, analyst, async () => {
      await client.query("insert into public.categories (name) values ('analyst-ok')");
      const deleted = await client.query("delete from public.categories where name = $1", [
        seededCategory,
      ]);
      assert.equal(deleted.rowCount, 0, "delete is admin-only");
    });
  });

  await t.test("analyst cannot read app_settings or audit_logs", async () => {
    await asUser(client, analyst, async () => {
      assert.equal((await client.query("select * from public.app_settings")).rowCount, 0);
      assert.equal((await client.query("select * from public.audit_logs")).rowCount, 0);
    });
  });

  await t.test("admin reads app_settings and deletes business rows", async () => {
    await asUser(client, admin, async () => {
      const settings = await client.query("select * from public.app_settings");
      assert.ok((settings.rowCount ?? 0) > 0, "seeded settings must be visible to admin");
      const deleted = await client.query("delete from public.categories where name = $1", [
        seededCategory,
      ]);
      assert.equal(deleted.rowCount, 1);
    });
  });

  await t.test("no role can change its own role row", async () => {
    for (const [label, id] of [
      ["viewer", viewer], ["analyst", analyst], ["admin", admin],
    ] as const) {
      await asUser(client, id, async () => {
        const updated = await client.query(
          "update public.user_roles set role = 'admin' where user_id = $1",
          [id],
        );
        assert.equal(updated.rowCount, 0, `${label} must not self-promote`);
        const deleted = await client.query("delete from public.user_roles where user_id = $1", [id]);
        assert.equal(deleted.rowCount, 0, `${label} must not delete its own role row`);
      });
    }
  });

  await t.test("admin can change someone else's role", async () => {
    await asUser(client, admin, async () => {
      const { rowCount } = await client.query(
        "update public.user_roles set role = 'analyst' where user_id = $1",
        [viewer],
      );
      assert.equal(rowCount, 1);
    });
  });

  await t.test("non-admin cannot grant a role to anyone", async () => {
    await asUser(client, analyst, async () => {
      const { rowCount } = await client.query(
        "update public.user_roles set role = 'admin' where user_id = $1",
        [viewer],
      );
      assert.equal(rowCount, 0);
    });
  });

  await t.test("soft-deleted rows disappear from reads", async () => {
    const name = `deleted-${Date.now()}`;
    const { rows } = await client.query(
      "insert into public.categories (name, deleted_at) values ($1, now()) returning id",
      [name],
    );
    await asUser(client, viewer, async () => {
      const seen = await client.query("select * from public.categories where id = $1", [rows[0].id]);
      assert.equal(seen.rowCount, 0);
    });
    await client.query("delete from public.categories where id = $1", [rows[0].id]);
  });

  await t.test("current_user_role() cannot be told which user to look up", async () => {
    // It must derive identity from auth.uid() only. A version taking a user_id
    // argument would let any caller ask for someone else's role.
    const { rows } = await client.query(
      `select pronargs from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'current_user_role'`,
    );
    assert.equal(rows.length, 1, "current_user_role must exist exactly once");
    assert.equal(rows[0].pronargs, 0, "current_user_role must take no arguments");
  });

  await t.test("current_user_role() follows the JWT, not the caller's wishes", async () => {
    await asUser(client, viewer, async () => {
      const { rows } = await client.query("select public.current_user_role() as role");
      assert.equal(rows[0].role, "viewer");
    });
    await asUser(client, admin, async () => {
      const { rows } = await client.query("select public.current_user_role() as role");
      assert.equal(rows[0].role, "admin");
    });
    await asUser(client, roleless, async () => {
      const { rows } = await client.query("select public.current_user_role() as role");
      assert.equal(rows[0].role, null);
    });
  });

  await t.test("privileged connection bypasses RLS", async () => {
    // Proves requireRole() in Node is the only guard on the write path.
    const { rowCount } = await client.query("select * from public.app_settings");
    assert.ok((rowCount ?? 0) > 0, "owner connection must see admin-only rows");
  });
});
