/**
 * Every number on the hosted pilot opens exactly the ads it counted.
 *
 *   PT_GLORY_ENV=pilot PILOT_PROOF_EMAIL=… PILOT_PROOF_PASSWORD=… \
 *     node --env-file-if-exists=.env.local scripts/pilot-evidence-proof.mjs
 *
 * The DB suites prove this exhaustively, and cannot run without a local stack.
 * This proves it where it now matters more: on the deployed runtime, over real
 * collected data, through the same HTTP routes a browser uses. A count that
 * disagreed with its evidence here would be a false claim on screen even though
 * the SQL behind it is correct — serialization, paging and filter plumbing all
 * sit between the two.
 *
 * Read-only. Nothing is created, changed or removed.
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

const { data: auth, error } = await createClient(url, anonKey, { auth: { persistSession: false } })
  .auth.signInWithPassword({
    email: process.env.PILOT_PROOF_EMAIL, password: process.env.PILOT_PROOF_PASSWORD,
  });
if (error) { console.error("sign-in failed:", error.message); process.exit(1); }

const jar = [];
const ssr = createServerClient(url, anonKey, {
  cookies: { getAll: () => [], setAll: (list) => jar.push(...list) },
});
await ssr.auth.setSession({
  access_token: auth.session.access_token, refresh_token: auth.session.refresh_token,
});
const cookie = jar.map(({ name, value }) => `${name}=${value}`).join("; ");

const results = [];
const record = (ok, label, detail) => {
  results.push({ ok, label, detail });
  console.log(`${ok ? "ok  " : "FAIL"}  ${label} — ${detail}`);
};

/** The evidence endpoint reports its own total; that is what a screen shows. */
async function evidenceTotal(pageId, params) {
  const query = new URLSearchParams({ limit: "1", ...params });
  const response = await fetch(`${BASE}/api/pages/${pageId}/ads?${query}`, { headers: { cookie } });
  if (!response.ok) throw new Error(`evidence request failed: HTTP ${response.status}`);
  const body = await response.json();
  return { total: Number(body.total), rows: body.rows?.length ?? 0 };
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: categories } = await client.query(
  "select id, name from public.categories order by name limit 1");
const category = categories[0];
const scope = `category:${category.id}`;
console.log(`scope: ${category.name} (${scope})\n`);

// The page the reviewer is most likely to open: the one with the most ads.
const { rows: top } = await client.query(
  `select page_id, observed_ads, recently_found, evergreen_ads, reused_ads, active_ads
     from public.page_list('category', $1, null, null, null, 30, 'observed_ads', 1, 0)`,
  [category.id],
);
const page = top[0];
console.log(`page ${page.page_id}: observed ${page.observed_ads}, recent ${page.recently_found}, `
  + `evergreen ${page.evergreen_ads}, reused ${page.reused_ads}, active ${page.active_ads}\n`);

/*
 * Each KPI is a promise that a specific set of ads exists. The signal keys are
 * the same ones the screen puts in the URL when a number is clicked.
 */
for (const [label, signal, expected] of [
  ["Ads ที่พบ", null, Number(page.observed_ads)],
  ["พบใหม่", "recent", Number(page.recently_found)],
  ["Evergreen", "evergreen", Number(page.evergreen_ads)],
  ["ใช้ซ้ำ", "reused", Number(page.reused_ads)],
  ["กำลังแสดง", "active", Number(page.active_ads)],
]) {
  const params = { scope, recentDays: "30" };
  if (signal) params.signal = signal;
  const evidence = await evidenceTotal(page.page_id, params);
  record(evidence.total === expected, `page KPI "${label}" opens its own ads`,
    `screen ${expected} vs evidence ${evidence.total}`);
}

/* -------------------------------------------------- one creative-mix bucket */

const { rows: mix } = await client.query(
  `select value, n from public.page_creative_mix('category', $1, $2)
    where dimension = 'display_format' order by n desc limit 1`,
  [category.id, page.page_id],
);
if (mix[0]) {
  const evidence = await evidenceTotal(page.page_id, { scope, format: mix[0].value });
  record(evidence.total === Number(mix[0].n), `format bucket "${mix[0].value}" opens its own ads`,
    `screen ${mix[0].n} vs evidence ${evidence.total}`);
}

/* ------------------------------------------- the same page in a dataset scope */

/*
 * Snapshot pinning, through the evidence route rather than through SQL: the
 * older dataset must still report what its own run saw, whatever the newer run
 * later observed.
 */
const { rows: datasets } = await client.query(
  "select id, name from public.datasets order by created_at");
for (const dataset of datasets) {
  const { rows: detail } = await client.query(
    "select observed_ads from public.page_detail('dataset', $1, $2, 30)", [dataset.id, page.page_id],
  );
  if (!detail[0]) continue;
  const evidence = await evidenceTotal(page.page_id, { scope: `dataset:${dataset.id}` });
  record(evidence.total === Number(detail[0].observed_ads),
    `dataset "${dataset.name}" reports its own run`,
    `screen ${detail[0].observed_ads} vs evidence ${evidence.total}`);
}

/* ------------------------------------------------------------- refusals */

const noScope = await fetch(`${BASE}/api/pages/${page.page_id}/ads`, { headers: { cookie } });
record(noScope.status === 400, "evidence with no scope is refused, not widened",
  `HTTP ${noScope.status}`);

const badSignal = await fetch(
  `${BASE}/api/pages/${page.page_id}/ads?scope=${scope}&signal=profitable`, { headers: { cookie } });
record(badSignal.status === 400, "an unknown signal is refused, not ignored",
  `HTTP ${badSignal.status}`);

const badPage = await fetch(`${BASE}/api/pages/not-a-page/ads?scope=${scope}`, { headers: { cookie } });
record(badPage.status === 400, "a malformed page id is refused", `HTTP ${badPage.status}`);

const signedOut = await fetch(`${BASE}/api/pages/${page.page_id}/ads?scope=${scope}`);
record(signedOut.status === 401, "evidence requires a session", `HTTP ${signedOut.status}`);

await client.end();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} hosted evidence assertions passed`);
if (failed.length > 0) process.exit(1);
