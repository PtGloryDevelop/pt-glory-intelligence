import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { connect } from "./helpers.ts";

/**
 * The read API's permission surface, asserted against the live database rather
 * than against the migration text.
 *
 * Postgres grants EXECUTE to PUBLIC on every new function, and Supabase adds
 * default privileges that grant it to `anon` by name on top of that. Neither is
 * visible in the CREATE FUNCTION statement, so only the catalog can say who can
 * actually call these.
 */

const READ_FUNCTIONS = [
  "public.dataset_context(uuid)",
  "public.dataset_ads_page(uuid, text, text, text, text, text, text, int, int)",
  "public.dataset_ads_facets(uuid)",
  "public.ad_detail(text, uuid)",
  "public.ad_observation_history(text)",
  "public.dataset_list()",
  "public.current_user_role()",
];

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("read function permissions", { skip }, async (t) => {
  const client = await connect();
  t.after(() => client.end());

  await t.test("anon cannot execute any read function", async () => {
    for (const fn of READ_FUNCTIONS) {
      const { rows } = await client.query<{ can: boolean }>(
        "select has_function_privilege('anon', $1, 'execute') as can", [fn],
      );
      assert.equal(rows[0].can, false, `${fn} must not be callable by anon`);
    }
  });

  await t.test("authenticated keeps execute on every read function", async () => {
    for (const fn of READ_FUNCTIONS) {
      const { rows } = await client.query<{ can: boolean }>(
        "select has_function_privilege('authenticated', $1, 'execute') as can", [fn],
      );
      assert.equal(rows[0].can, true, `${fn} must stay callable by authenticated`);
    }
  });

  await t.test("PUBLIC holds no execute grant on the read API", async () => {
    const { rows } = await client.query<{ proname: string; proacl: string | null }>(
      `select proname, proacl::text as proacl from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('dataset_context','dataset_ads_page','dataset_ads_facets',
                          'ad_detail','ad_observation_history','current_user_role')`,
    );
    assert.equal(rows.length, 6);
    for (const row of rows) {
      assert.ok(row.proacl, `${row.proname} must have an explicit ACL, not the default`);
      // A PUBLIC entry appears as a leading "=X/owner" with no role name.
      assert.doesNotMatch(row.proacl!, /(^|,)\{?=X/, `${row.proname} still grants PUBLIC`);
      assert.doesNotMatch(row.proacl!, /\banon=/, `${row.proname} still names anon`);
    }
  });

  await t.test("read functions stay SECURITY INVOKER with a pinned search_path", async () => {
    const { rows } = await client.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      `select proname, prosecdef, proconfig from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in ('dataset_context','dataset_ads_page','dataset_ads_facets',
                          'ad_detail','ad_observation_history')`,
    );
    assert.equal(rows.length, 5);
    for (const row of rows) {
      // SECURITY DEFINER here would run the query as the owner and bypass RLS,
      // which is the whole boundary dbUser() relies on.
      assert.equal(row.prosecdef, false, `${row.proname} must remain SECURITY INVOKER`);
      assert.ok(
        row.proconfig?.some((entry) => entry.startsWith("search_path=")),
        `${row.proname} must pin a search_path`,
      );
    }
  });

  await t.test("current_user_role stays SECURITY DEFINER — it is the one that must", async () => {
    const { rows } = await client.query<{ prosecdef: boolean }>(
      "select prosecdef from pg_proc where pronamespace='public'::regnamespace and proname='current_user_role'",
    );
    assert.equal(rows[0].prosecdef, true);
  });
});

const anonSkip = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? false
  : "Supabase URL / anon key not set";

test("an anonymous caller reaches nothing through PostgREST", { skip: anonSkip }, async () => {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );

  const rpc = await anon.rpc("dataset_ads_page", {
    p_dataset_id: "00000000-0000-4000-8000-000000000000",
    p_active: null, p_format: null, p_cta: null, p_platform: null,
    p_category: null, p_search: null, p_limit: 30, p_offset: 0,
  });
  assert.ok(rpc.error, "anon must be refused the RPC outright");

  // Belt and braces: the tables it reads are closed to anon as well.
  const table = await anon.from("ads").select("ad_archive_id").limit(1);
  assert.deepEqual(table.data ?? [], [], "anon must not read ads directly either");
});
