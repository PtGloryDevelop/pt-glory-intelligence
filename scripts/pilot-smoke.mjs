/**
 * Read-only smoke test against the hosted pilot.
 *
 *   PT_GLORY_ENV=pilot node --env-file-if-exists=.env.local scripts/pilot-smoke.mjs
 *
 * Walks the real deployment as a real signed-in user and asserts each surface
 * rendered its own data. It writes nothing: no import, no mapping, no watch. A
 * pilot database holds work people care about, so the smoke test reads.
 *
 * The session is installed as cookies rather than typed into the login form.
 * They are produced by @supabase/ssr itself — the same code the application
 * reads them with — so this exercises the real session path rather than a
 * hand-rolled imitation of it.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.PILOT_URL ?? "https://pt-glory-intelligence.vercel.app";
const OUT = join("test-artifacts", "visual", "pilot-smoke");

const email = process.env.PILOT_SMOKE_EMAIL;
const password = process.env.PILOT_SMOKE_PASSWORD;
if (!email || !password) {
  console.error("set PILOT_SMOKE_EMAIL and PILOT_SMOKE_PASSWORD for this run");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const { data: auth, error } = await createClient(url, anonKey, { auth: { persistSession: false } })
  .auth.signInWithPassword({ email, password });
if (error) {
  console.error("sign-in failed:", error.message);
  process.exit(1);
}

/*
 * Hand the session to the library and record what it decides to store. Chunking,
 * the base64 prefix and the cookie name are its business, not ours — replicating
 * them here would test our imitation instead of the real thing.
 */
const jar = [];
const server = createServerClient(url, anonKey, {
  cookies: { getAll: () => [], setAll: (list) => jar.push(...list) },
});
await server.auth.setSession({
  access_token: auth.session.access_token,
  refresh_token: auth.session.refresh_token,
});
if (jar.length === 0) {
  console.error("the ssr client stored no cookies — cannot install a session");
  process.exit(1);
}

const host = new URL(BASE).hostname;
const cookies = jar.map(({ name, value }) => ({
  name, value, domain: host, path: "/", httpOnly: false, secure: true, sameSite: "Lax",
}));

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies(cookies);
const page = await context.newPage();

const results = [];
const failures = [];

/** Visits a URL and asserts the named testids are present. */
async function check(label, path, testIds, shot) {
  const started = Date.now();
  try {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? 0;
    for (const id of testIds) {
      await page.locator(`[data-testid="${id}"]`).first().waitFor({ timeout: 20000 });
    }
    const ms = Date.now() - started;
    if (shot) {
      await page.screenshot({ path: join(OUT, `${shot}.png`), fullPage: true, animations: "disabled" });
    }
    results.push({ label, path, status, ms });
    console.log(`ok    ${String(ms).padStart(5)}ms  ${label}`);
    return true;
  } catch (problem) {
    const ms = Date.now() - started;
    results.push({ label, path, status: "error", ms });
    failures.push(`${label}: ${String(problem).split("\n")[0]}`);
    console.log(`FAIL  ${String(ms).padStart(5)}ms  ${label}`);
    return false;
  }
}

// Identity first: an unauthenticated session would redirect and every check
// below would fail for one uninteresting reason.
await check("home", "/", ["app-sidebar", "sign-out"], "home");
await check("datasets", "/datasets", ["dataset-list"], "datasets");

const datasetId = await page.locator('[data-testid^="dataset-row-"]').first()
  .getAttribute("data-testid").then((v) => v?.replace("dataset-row-", "") ?? null).catch(() => null);
if (datasetId) {
  await check("dataset detail + explorer", `/datasets/${datasetId}`, ["ads-grid"], "dataset-detail");
}

/*
 * Archived media, proven on the hosted deployment.
 *
 * Two separate claims: the preview a card shows comes from our own private
 * bucket through a signed URL minted for this request — not from Meta's CDN,
 * which is exactly what expires — and the browser actually decoded it. A broken
 * image and a missing image look identical in a screenshot.
 */
if (datasetId) {
  const media = await page.evaluate(() => {
    const images = [...document.querySelectorAll('[data-testid^="ad-card-"] img')];
    const loaded = images.filter((img) => img.naturalWidth > 0);
    return {
      total: images.length,
      loaded: loaded.length,
      signed: loaded.filter((img) => img.currentSrc.includes("/storage/v1/object/sign/")).length,
      fromMetaCdn: loaded.filter((img) => /fbcdn\.net|facebook\.com/.test(img.currentSrc)).length,
      sample: loaded[0]?.currentSrc.split("?")[0] ?? null,
    };
  });
  console.log(`media   images=${media.total} decoded=${media.loaded} signed=${media.signed} fromMetaCdn=${media.fromMetaCdn}`);
  console.log(`        sample: ${media.sample}`);
  /*
   * A card whose asset is not archived YET still shows the source URL — that is
   * the frozen behaviour, and it is why the queue exists. So the assertion is
   * that archived media reaches the browser from our bucket, not that no source
   * URL appears anywhere: with a queue still draining, some will.
   */
  if (media.signed === 0) {
    failures.push("no archived preview was served from the private bucket");
  }
  if (media.fromMetaCdn > 0) {
    console.log(`        ${media.fromMetaCdn} preview(s) still on the source CDN — expected while the queue drains`);
  }
}

await check("categories", "/categories", ["category-list"], "categories");
const categoryId = await page.locator('[data-testid^="category-row-"]').first()
  .getAttribute("data-testid").then((v) => v?.replace("category-row-", "") ?? null).catch(() => null);
if (categoryId) {
  await check("category workspace", `/categories/${categoryId}`, ["category-basis"], "category");
}

const scope = categoryId ? `category:${categoryId}` : "all";
await check("pages", `/pages?scope=${scope}`, ["page-list"], "pages");
const pageId = await page.locator('[data-testid^="page-row-"]').first()
  .getAttribute("data-testid").then((v) => v?.replace("page-row-", "") ?? null).catch(() => null);
if (pageId) {
  await check("page intelligence", `/pages/${pageId}?scope=${scope}`, ["kpi-observed", "mix-format"], "page-detail");
  await check("page timeline", `/pages/${pageId}?scope=${scope}&view=timeline`, ["page-tabs"], "timeline");
}

await check("trends", `/trends?scope=${scope}`, ["trend-summary"], "trends");
await check("compare chooser", `/compare?scope=${scope}`, ["app-sidebar"], "compare");
await check("watchlist", "/watchlist", ["watchlist-basis"], "watchlist");
await check("brands", "/brands", ["brand-basis"], "brands");
await check("unmapped queue", "/unmapped-pages", ["unmapped-table"], "unmapped");

// A phone-sized pass over the surfaces a reviewer actually opens on a phone.
await page.setViewportSize({ width: 375, height: 812 });
const overflows = () => page.evaluate(() =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
for (const [label, path, shot] of [
  ["datasets (375)", "/datasets", "datasets-375"],
  ["pages (375)", `/pages?scope=${scope}`, "pages-375"],
  ["unmapped (375)", "/unmapped-pages", "unmapped-375"],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  const wide = await overflows();
  await page.screenshot({ path: join(OUT, `${shot}.png`), fullPage: true, animations: "disabled" });
  if (wide) failures.push(`${label}: the page overflows sideways`);
  console.log(`${wide ? "FAIL" : "ok   "}        ${label}`);
}

await browser.close();

console.log("\n--- server time per surface ---");
console.table(results);
if (failures.length > 0) {
  console.log("\nfailures:");
  for (const failure of failures) console.log(` - ${failure}`);
  process.exit(1);
}
console.log(`\nall ${results.length} hosted surfaces rendered. screenshots in ${OUT}`);
