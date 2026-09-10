/**
 * Proves the role contract on the HOSTED deployment, through its own HTTP API.
 *
 *   PT_GLORY_ENV=pilot PILOT_PROOF_EMAIL=… PILOT_PROOF_PASSWORD=… \
 *     node --env-file-if-exists=.env.local scripts/pilot-role-proof.mjs
 *
 * Everything goes through the public routes with a real signed-in session, so
 * what is proven is what a person's browser would get. The service-role key is
 * never used to make an assertion pass — it appears only in the cleanup at the
 * end, to remove editorial rows this script itself created.
 *
 * Optional second account, for the cross-user proof:
 *   PILOT_PROOF_EMAIL_B / PILOT_PROOF_PASSWORD_B
 */
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { isPilotProject } from "./destructive-guard.mjs";

const BASE = process.env.PILOT_URL ?? "https://pt-glory-intelligence.vercel.app";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if ((process.env.PT_GLORY_ENV ?? "").toLowerCase() !== "pilot") {
  console.error("refused: PT_GLORY_ENV=pilot is not set");
  process.exit(1);
}
if (!isPilotProject(process.env.DATABASE_URL)) {
  console.error("refused: DATABASE_URL does not point at the pilot project");
  process.exit(1);
}

const results = [];
const record = (ok, label, detail = "") => {
  results.push({ ok, label, detail });
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/** Signs in and returns a Cookie header the hosted app will accept. */
async function sessionFor(email, password) {
  const { data, error } = await createClient(url, anonKey, { auth: { persistSession: false } })
    .auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);

  const jar = [];
  const ssr = createServerClient(url, anonKey, {
    cookies: { getAll: () => [], setAll: (list) => jar.push(...list) },
  });
  await ssr.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  return {
    userId: data.user.id,
    cookie: jar.map(({ name, value }) => `${name}=${value}`).join("; "),
  };
}

const call = async (session, path, init = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      cookie: session.cookie,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: response.status, body };
};

const email = process.env.PILOT_PROOF_EMAIL;
const password = process.env.PILOT_PROOF_PASSWORD;
if (!email || !password) {
  console.error("set PILOT_PROOF_EMAIL and PILOT_PROOF_PASSWORD");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const a = await sessionFor(email, password);
const roleA = (await client.query(
  "select role from public.user_roles where user_id = $1", [a.userId])).rows[0]?.role;
console.log(`account A: ${email} (${roleA})\n`);

/* ------------------------------------------------- brand mapping, hosted */

const stamp = Date.now();
const BRAND_1 = `ทดสอบสิทธิ์ A ${stamp}`;
const BRAND_2 = `ทดสอบสิทธิ์ B ${stamp}`;
const createdBrands = [];

// A page nobody has mapped, chosen from the real queue rather than invented.
const { rows: queue } = await client.query(
  "select page_id from public.unmapped_pages('all', null, null, 'observed_ads', 1, 0)");
const pageId = queue[0]?.page_id;
if (!pageId) {
  console.error("no unmapped page available to run the mapping proof against");
  process.exit(1);
}
console.log(`controlled page: ${pageId}\n`);

const brand1 = await call(a, "/api/brands", { method: "POST", body: JSON.stringify({ name: BRAND_1 }) });
record(brand1.status === 201, "analyst/admin may create a Brand", `HTTP ${brand1.status}`);
if (brand1.body?.id) createdBrands.push(brand1.body.id);

const brand2 = await call(a, "/api/brands", { method: "POST", body: JSON.stringify({ name: BRAND_2 }) });
if (brand2.body?.id) createdBrands.push(brand2.body.id);

const duplicate = await call(a, "/api/brands", {
  method: "POST", body: JSON.stringify({ name: `  ${BRAND_1.toUpperCase()}  ` }),
});
record(
  duplicate.status === 409 && (duplicate.body?.duplicates ?? []).length > 0,
  "a duplicate name is refused and the existing Brand offered",
  `HTTP ${duplicate.status}`,
);

const mapped = await call(a, "/api/brand-mappings", {
  method: "POST", body: JSON.stringify({ brandId: createdBrands[0], pageId, note: "role proof" }),
});
record(mapped.status === 201, "analyst/admin may map a Page to a Brand", `HTTP ${mapped.status}`);

const moved = await call(a, "/api/brand-mappings", {
  method: "POST", body: JSON.stringify({ brandId: createdBrands[1], pageId, note: "moved by proof" }),
});
record(moved.status === 201, "analyst/admin may move a Page between Brands", `HTTP ${moved.status}`);

const { rows: history } = await client.query(
  "select brand_id, is_current, note from public.brand_mapping_history(null, $1, 100)", [pageId]);
record(
  history.length === 2 && history[0].is_current && history[0].brand_id === createdBrands[1]
    && !history[1].is_current && history[1].brand_id === createdBrands[0],
  "history keeps both decisions, newest current",
  history.map((h) => `${h.is_current ? "current" : "closed"}:${h.note}`).join(" | "),
);

const unmapped = await call(a, `/api/brand-mappings?pageId=${pageId}`, { method: "DELETE" });
record(unmapped.status === 200 && unmapped.body?.changed === true, "analyst/admin may unmap", `HTTP ${unmapped.status}`);

const { rows: backInQueue } = await client.query(
  "select 1 from public.unmapped_pages('all', null, null, 'observed_ads', 5000, 0) where page_id = $1", [pageId]);
record(backInQueue.length === 1, "the Page returns to the review queue");

const { rows: afterUnmap } = await client.query(
  "select count(*)::int n from public.brand_mapping_history(null, $1, 100)", [pageId]);
record(afterUnmap[0].n === 2, "unmapping deleted no history", `${afterUnmap[0].n} rows kept`);

/* --------------------------------------------------- watchlist, own state */

const watch = await call(a, "/api/watchlist", {
  method: "POST",
  body: JSON.stringify({ targetType: "page", pageId, scope: "all", signals: ["PAGE_NEWLY_FOUND_AD"] }),
});
record(watch.status === 201, "a signed-in user may save their own watch", `HTTP ${watch.status}`);
const watchId = watch.body?.id ?? null;

if (watchId) {
  const before = (await client.query(
    "select baseline_at from public.watch_items where id = $1", [watchId])).rows[0].baseline_at;

  const edit = await call(a, `/api/watchlist/${watchId}`, {
    method: "PATCH", body: JSON.stringify({ signals: ["PAGE_NEWLY_FOUND_AD", "PAGE_STARTED_AD"] }),
  });
  const afterEdit = (await client.query(
    "select baseline_at from public.watch_items where id = $1", [watchId])).rows[0].baseline_at;
  record(
    edit.status === 200 && new Date(afterEdit).getTime() === new Date(before).getTime(),
    "editing tracked signals does not move the baseline",
    `HTTP ${edit.status}`,
  );

  const reset = await call(a, `/api/watchlist/${watchId}/baseline`, { method: "POST" });
  const afterReset = (await client.query(
    "select baseline_at from public.watch_items where id = $1", [watchId])).rows[0].baseline_at;
  record(
    reset.status === 200 && new Date(afterReset).getTime() > new Date(before).getTime(),
    "resetting the baseline moves it, and only when asked",
    `HTTP ${reset.status}`,
  );
}

/* ------------------------------------------------------------ second user */

const emailB = process.env.PILOT_PROOF_EMAIL_B;
const passwordB = process.env.PILOT_PROOF_PASSWORD_B;
let watchIdB = null;

if (emailB && passwordB) {
  const b = await sessionFor(emailB, passwordB);
  const roleB = (await client.query(
    "select role from public.user_roles where user_id = $1", [b.userId])).rows[0]?.role;
  console.log(`\naccount B: ${emailB} (${roleB})`);

  const watchB = await call(b, "/api/watchlist", {
    method: "POST",
    body: JSON.stringify({ targetType: "page", pageId, scope: "all", signals: ["PAGE_STARTED_AD"] }),
  });
  watchIdB = watchB.body?.id ?? null;
  record(watchB.status === 201, "B may save their own watch", `HTTP ${watchB.status}`);

  // Cross-user, through the hosted API rather than through SQL.
  if (watchIdB) {
    const aReadsB = await call(a, `/api/watchlist/${watchIdB}`, {
      method: "PATCH", body: JSON.stringify({ signals: ["PAGE_STARTED_AD"] }),
    });
    record([404, 403].includes(aReadsB.status), "A cannot update B's watch", `HTTP ${aReadsB.status}`);

    const aDeletesB = await call(a, `/api/watchlist/${watchIdB}`, { method: "DELETE" });
    record([404, 403].includes(aDeletesB.status), "A cannot delete B's watch", `HTTP ${aDeletesB.status}`);
  }
  if (watchId) {
    const bReadsA = await call(b, `/api/watchlist/${watchId}`, {
      method: "PATCH", body: JSON.stringify({ signals: ["PAGE_STARTED_AD"] }),
    });
    record([404, 403].includes(bReadsA.status), "B cannot update A's watch", `HTTP ${bReadsA.status}`);
  }

  if (roleB === "viewer") {
    const create = await call(b, "/api/brands", {
      method: "POST", body: JSON.stringify({ name: `viewer must not create ${stamp}` }),
    });
    record(create.status === 403, "a viewer may not create a Brand", `HTTP ${create.status}`);

    const map = await call(b, "/api/brand-mappings", {
      method: "POST", body: JSON.stringify({ brandId: createdBrands[0], pageId }),
    });
    record(map.status === 403, "a viewer may not map a Page", `HTTP ${map.status}`);

    const unmap = await call(b, `/api/brand-mappings?pageId=${pageId}`, { method: "DELETE" });
    record(unmap.status === 403, "a viewer may not unmap a Page", `HTTP ${unmap.status}`);

    const rename = await call(b, `/api/brands/${createdBrands[0]}`, {
      method: "PATCH", body: JSON.stringify({ name: `viewer rename ${stamp}` }),
    });
    record(rename.status === 403, "a viewer may not rename a Brand", `HTTP ${rename.status}`);

    const archive = await call(b, `/api/brands/${createdBrands[0]}`, {
      method: "PATCH", body: JSON.stringify({ status: "archived" }),
    });
    record(archive.status === 403, "a viewer may not archive a Brand", `HTTP ${archive.status}`);

    const read = await call(b, "/api/brands?search=", { method: "GET" });
    record(read.status === 200, "a viewer may still read Brands", `HTTP ${read.status}`);
  }
} else {
  console.log("\n(no second account supplied — cross-user and viewer proofs skipped)");
}

/* ---------------------------------------------------------------- cleanup */

// Only what this script created. Unrelated editorial state is never touched.
for (const id of [watchId, watchIdB].filter(Boolean)) {
  await client.query("delete from public.watch_items where id = $1", [id]);
}
await client.query(
  "delete from public.brand_page_mappings where brand_id = any($1::uuid[])", [createdBrands]);
await client.query("delete from public.brands where id = any($1::uuid[])", [createdBrands]);

const { rows: leftovers } = await client.query(
  "select count(*)::int n from public.brands where name like $1", [`ทดสอบสิทธิ์%${stamp}`]);
record(leftovers[0].n === 0, "test-owned editorial state removed");

const { rows: stillMapped } = await client.query(
  "select count(*)::int n from public.brand_mapping_at(now()) where page_id = $1", [pageId]);
record(stillMapped[0].n === 0, "the controlled page is left unmapped, as found");

await client.end();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} hosted role assertions passed`);
if (failed.length > 0) process.exit(1);
