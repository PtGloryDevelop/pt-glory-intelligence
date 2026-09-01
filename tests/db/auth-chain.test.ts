import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

/**
 * End-to-end proof of the authorization chain through the real stack:
 *
 *   Supabase Auth  →  JWT  →  auth.uid()  →  current_user_role()  →  RLS
 *
 * The DB-level matrix in rls.test.ts sets `request.jwt.claims` by hand. This one
 * never touches that GUC: it signs a user in for real and lets PostgREST derive
 * the claims, so a mistake in how the JWT reaches the database would show up here
 * and nowhere else.
 *
 * Needs a running stack (`supabase start`) plus the service-role key for user
 * creation. Skipped when the env is absent.
 */
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const skip = url && anonKey && serviceKey
  ? false
  : "Supabase URL / publishable(anon) / secret(service-role) key not set";

const PASSWORD = "gate-a-verification-pw";

test("Auth → JWT → auth.uid() → current_user_role() → RLS", { skip }, async (t) => {
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const created: string[] = [];

  t.after(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
  });

  /** Creates a confirmed user, optionally granting a role row. */
  async function makeUser(role: "viewer" | "analyst" | "admin" | null, tag: string) {
    const email = `chain-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    assert.ifError(error);
    const id = data.user!.id;
    created.push(id);
    if (role) {
      const { error: roleError } = await admin.from("user_roles").insert({ user_id: id, role });
      assert.ifError(roleError);
    }
    return { id, email };
  }

  /** Signs in through GoTrue and returns a PostgREST client carrying that JWT. */
  async function signIn(email: string) {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    assert.ifError(error);
    assert.ok(data.session?.access_token, "sign-in must return an access token");
    return { client, userId: data.user!.id };
  }

  const viewer = await makeUser("viewer", "viewer");
  const analystUser = await makeUser("analyst", "analyst");
  const adminUser = await makeUser("admin", "admin");
  const roleless = await makeUser(null, "norole");

  const seededCategory = `chain-seed-${Date.now()}`;
  const { error: seedError } = await admin.from("categories").insert({ name: seededCategory });
  assert.ifError(seedError);
  t.after(() => admin.from("categories").delete().eq("name", seededCategory));

  await t.test("anonymous key alone reads nothing", async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data } = await anon.from("categories").select("*");
    assert.deepEqual(data ?? [], [], "anon must not read categories");
  });

  await t.test("signed-in viewer reads through a real JWT", async () => {
    const { client } = await signIn(viewer.email);
    const { data, error } = await client.from("categories").select("*").eq("name", seededCategory);
    assert.ifError(error);
    assert.equal(data?.length, 1, "viewer should see the seeded category");
  });

  await t.test("signed-in user without a role row is denied", async () => {
    const { client } = await signIn(roleless.email);
    const { data } = await client.from("categories").select("*");
    assert.deepEqual(data ?? [], [], "a roleless account must read nothing");
  });

  await t.test("viewer write is refused by RLS, not by the UI", async () => {
    const { client } = await signIn(viewer.email);
    const { error } = await client.from("categories").insert({ name: `viewer-fail-${Date.now()}` });
    assert.ok(error, "insert must fail");
    assert.match(`${error?.message} ${error?.code}`, /row-level security|42501/i);
  });

  await t.test("analyst write succeeds through the same chain", async () => {
    const { client } = await signIn(analystUser.email);
    const name = `analyst-ok-${Date.now()}`;
    const { error } = await client.from("categories").insert({ name });
    assert.ifError(error);
    t.after(() => admin.from("categories").delete().eq("name", name));
  });

  await t.test("auth.uid() resolves to the signed-in user", async () => {
    // Proven with a viewer, not an admin: the user_roles policy lets admins read
    // every row, so an admin result could not distinguish "auth.uid() matched"
    // from "the admin branch matched". A viewer only ever passes the
    // `user_id = auth.uid()` branch, so exactly one row is the proof.
    const { client, userId } = await signIn(viewer.email);
    const { data, error } = await client.from("user_roles").select("user_id, role");
    assert.ifError(error);
    assert.equal(data?.length, 1, "a viewer must see only its own role row");
    assert.equal(data?.[0].user_id, userId);
    assert.equal(data?.[0].role, "viewer");
  });

  await t.test("admin sees other people's role rows through the admin branch", async () => {
    const { client } = await signIn(adminUser.email);
    const { data, error } = await client.from("user_roles").select("user_id");
    assert.ifError(error);
    const seen = new Set((data ?? []).map((row) => row.user_id));
    // Only the three role-holding users are asserted: `roleless` has no row by
    // design, and counting rows would depend on leftovers from other runs.
    for (const [label, id] of [
      ["viewer", viewer.id], ["analyst", analystUser.id], ["admin", adminUser.id],
    ] as const) {
      assert.ok(seen.has(id), `admin should see the ${label} role row`);
    }
  });

  await t.test("admin-only tables stay closed to analyst and open to admin", async () => {
    const asAnalyst = await signIn(analystUser.email);
    const { data: analystSettings } = await asAnalyst.client.from("app_settings").select("*");
    assert.deepEqual(analystSettings ?? [], []);

    const asAdmin = await signIn(adminUser.email);
    const { data: adminSettings, error } = await asAdmin.client.from("app_settings").select("*");
    assert.ifError(error);
    assert.ok((adminSettings?.length ?? 0) > 0, "admin must see seeded settings");
  });

  await t.test("nobody can escalate their own role through PostgREST", async () => {
    for (const user of [viewer, analystUser, adminUser]) {
      const { client, userId } = await signIn(user.email);
      const { data } = await client
        .from("user_roles")
        .update({ role: "admin" })
        .eq("user_id", userId)
        .select();
      assert.deepEqual(data ?? [], [], `${user.email} must not self-promote`);
    }
  });
});
