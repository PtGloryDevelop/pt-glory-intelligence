import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, resetTables } from "../tests/db/helpers.ts";
import { assertDestructiveAllowed } from "../scripts/destructive-guard.mjs";

/**
 * Puts the DEV database into a known state and signs two roles in through the
 * real login form, so the journey starts from a real session rather than a
 * hand-made cookie.
 */

import {
  ACCOUNTS, AUTH, CATEGORY, CATEGORY_BRAND, CATEGORY_COMPARE, CATEGORY_TRENDS,
  CATEGORY_WATCH, CATEGORY_WORKSPACE,
  PASSWORD, TMP,
} from "./constants.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Same order as tests/db/auth-chain.test.ts: the JWT service-role key is what
// this supabase-js version accepts on the admin API.
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!;

setup("prepare database, fixtures and sessions", async ({ browser, baseURL }) => {
  /*
   * The first thing this setup does, before a single file is written or a user
   * is created: prove the target database is disposable. Everything below is
   * destructive in one way or another — it truncates, it seeds fixtures, and it
   * assigns roles — and none of it belongs anywhere near real research data.
   */
  assertDestructiveAllowed(process.env.DATABASE_URL, "Playwright global setup");

  mkdirSync(TMP, { recursive: true });
  mkdirSync(AUTH, { recursive: true });
  writeFixtures();

  const admin: Admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const users = await Promise.all(
    Object.entries(ACCOUNTS).map(async ([role, email]) => ({
      role, email, id: await ensureUser(admin, email),
    })),
  );

  const client = await connect();
  try {
    await resetTables(client);
    // Six research categories: the shared one every spec imports into, plus one
    // each for the category workspace, compare, trends, the watchlist and brand
    // mapping — so their aggregates cannot be shifted by an unrelated spec
    // importing first.
    await client.query(
      "insert into public.categories (name) values ($1), ($2), ($3), ($4), ($5), ($6)",
      [CATEGORY, CATEGORY_WORKSPACE, CATEGORY_COMPARE, CATEGORY_TRENDS, CATEGORY_WATCH,
       CATEGORY_BRAND],
    );
    for (const { id, role } of users) {
      await client.query(
        `insert into public.user_roles (user_id, role) values ($1, $2)
         on conflict (user_id) do update set role = excluded.role`,
        [id, role],
      );
    }
  } finally {
    await client.end();
  }

  for (const { role, email } of users) {
    // baseURL rather than a literal port: the suite owns its own server now.
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("อีเมล").fill(email);
    await page.getByLabel("รหัสผ่าน").fill(PASSWORD);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    // The shell footer is the stable place the signed-in role appears; the home
    // page also prints it, so a bare text match now hits two elements.
    await expect(page.getByTestId("shell-role")).toHaveText(`สิทธิ์ ${role}`);
    await context.storageState({ path: join(AUTH, `${role}.json`) });
    await context.close();
  }
});

type Admin = ReturnType<typeof createClient>;

async function ensureUser(admin: Admin, email: string): Promise<string> {
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.data.user) return created.data.user.id;

  // Left over from an earlier run: reset the password so the login form works.
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = data.users.find((user) => user.email === email);
  if (!existing) {
    throw new Error(`could not create or find ${email}: ${created.error?.message ?? "unknown"}`);
  }
  await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD, email_confirm: true });
  return existing.id;
}

/** Small, valid exports derived from the golden fixture so counts stay honest. */
function writeFixtures() {
  const golden = JSON.parse(readFileSync("tests/fixtures/golden-500.json", "utf8"));
  const template = golden.ads[0];

  // A different ad and page from anything in the golden export, so the snapshot
  // proof counts only its own two runs.
  const OWN = { ad_archive_id: "700000000000001", page_id: "700000000000002" };

  const single = (generatedAt: string, overrides: Record<string, unknown>) => ({
    ...golden,
    generated_at: generatedAt,
    source_rows: 1, unique_ads: 1, unique_pages: 1, unresolved_count: 0,
    quality_summary: { ...golden.quality_summary, resolved_records: 1, unresolved_records: 0 },
    ads: [{ ...template, ...OWN, ...overrides }],
    unresolved_ads: [],
  });

  writeFileSync(join(TMP, "small-old.json"), JSON.stringify(
    single("2026-08-10T00:00:00.000Z", {
      is_active: true, display_format: "IMAGE", publisher_platform: ["FACEBOOK"],
      images: [], videos: [], cards: [],
    }),
  ));

  writeFileSync(join(TMP, "small-new.json"), JSON.stringify(
    single("2026-08-28T00:00:00.000Z", {
      is_active: false, display_format: "VIDEO", publisher_platform: ["INSTAGRAM"],
      images: [], videos: [], cards: [],
    }),
  ));

  // Unknown is not the same as false, and an absent field is not zero.
  writeFileSync(join(TMP, "small-unknown.json"), JSON.stringify(
    single("2026-08-12T00:00:00.000Z", {
      ad_archive_id: "700000000000003", is_active: null, display_format: null,
      cta_type: null, cta_text: null, end_date: null, caption: null,
      images: [], videos: [], cards: [],
    }),
  ));

  // The uploaded JSON is untrusted. These values must reach the page as text
  // and as a filtered-out media URL, never as markup or a navigable scheme.
  writeFileSync(join(TMP, "xss.json"), JSON.stringify(
    single("2026-08-14T00:00:00.000Z", {
      ad_archive_id: "700000000000004",
      title: "<script>window.__pwned = 'title'</script>",
      body_text: "<img src=x onerror=\"window.__pwned='body'\">ลดน้ำหนัก",
      caption: "<svg onload=\"window.__pwned='caption'\">",
      link_url: "javascript:window.__pwned='link'",
      cta_text: "</td></tr><script>window.__pwned='cta'</script>",
      images: [{ url: "javascript:window.__pwned='img'" }, { url: "data:text/html,<script>1</script>" }],
      videos: [], cards: [],
    }),
  ));

  // One row without an ad_archive_id: importable in part, so the run lands as partial.
  const noId: Record<string, unknown> = { ...template, page_id: "999888777666" };
  delete noId.ad_archive_id;
  writeFileSync(join(TMP, "partial.json"), JSON.stringify({
    ...golden,
    generated_at: "2026-08-20T00:00:00.000Z",
    source_rows: 2, unique_ads: 1, unique_pages: 2, unresolved_count: 1,
    quality_summary: { ...golden.quality_summary, resolved_records: 1, unresolved_records: 1 },
    ads: [{ ...template, ad_archive_id: "700000000000009" }],
    unresolved_ads: [noId],
  }));

  /*
   * The Page Intelligence fixtures.
   *
   * One page, five ads, built so the Page surfaces have something real to say:
   * three active / one stopped / one unreadable, only two of five with a
   * readable CTA, and a spread of formats and platforms. The 40% CTA coverage
   * is the point — it is what makes the low-coverage wording appear instead of
   * a confident percentage.
   *
   * The timeline fixtures below use their own page id, so the two specs cannot
   * contribute collection runs to each other's history: a run-count assertion
   * that depends on which other spec ran first is not an assertion.
   */
  type PageAd = {
    id: string; is_active: boolean | null; display_format: string | null;
    cta_type: string | null; publisher_platform: string[];
    collation_count: number; start: string;
  };

  const pageExport = (options: {
    pageId: string; pageName: string; likeCount: number;
    generatedAt: string; query?: string; ads: PageAd[];
  }) => ({
    ...golden,
    generated_at: options.generatedAt,
    scope: { ...golden.scope, query: options.query ?? golden.scope?.query ?? null },
    source_rows: options.ads.length, unique_ads: options.ads.length,
    unique_pages: 1, unresolved_count: 0,
    quality_summary: {
      ...golden.quality_summary, resolved_records: options.ads.length, unresolved_records: 0,
    },
    ads: options.ads.map((ad) => ({
      ...template,
      page_id: options.pageId,
      ad_archive_id: ad.id,
      page_name: options.pageName,
      page_categories: ["Medical Center", "Health/beauty"],
      page_like_count: options.likeCount,
      is_active: ad.is_active,
      display_format: ad.display_format,
      cta_type: ad.cta_type,
      cta_text: ad.cta_type === null ? null : "ทัก",
      publisher_platform: ad.publisher_platform,
      collation_count: ad.collation_count,
      start_date: ad.start,
      images: [], videos: [], cards: [],
    })),
    unresolved_ads: [],
  });

  const mixedAds: PageAd[] = [
    { id: "710000000000101", is_active: true,  display_format: "VIDEO", cta_type: "MESSAGE_PAGE",
      publisher_platform: ["FACEBOOK", "INSTAGRAM"], collation_count: 4, start: "2020-03-01T00:00:00.000Z" },
    { id: "710000000000102", is_active: true,  display_format: "IMAGE", cta_type: "LEARN_MORE",
      publisher_platform: ["FACEBOOK"], collation_count: 2, start: "2026-08-25T00:00:00.000Z" },
    { id: "710000000000103", is_active: true,  display_format: "IMAGE", cta_type: null,
      publisher_platform: ["INSTAGRAM", "MESSENGER"], collation_count: 1, start: "2026-07-01T00:00:00.000Z" },
    { id: "710000000000104", is_active: false, display_format: "MULTI_IMAGES", cta_type: null,
      publisher_platform: ["FACEBOOK"], collation_count: 1, start: "2021-05-01T00:00:00.000Z" },
    { id: "710000000000105", is_active: null,  display_format: null, cta_type: null,
      publisher_platform: [], collation_count: 1, start: "2019-11-01T00:00:00.000Z" },
  ];

  writeFileSync(join(TMP, "pages-mixed.json"), JSON.stringify(pageExport({
    pageId: "710000000000001", pageName: "คลินิกทดสอบ P2", likeCount: 4321,
    generatedAt: "2026-09-01T00:00:00.000Z", ads: mixedAds,
  })));

  /*
   * The timeline pair: the same page seen twice, days apart.
   *
   * Between the two runs one ad stops, one becomes unreadable and one appears
   * for the first time — and the second run asked a different query, which is
   * what the comparability caveat exists to point out.
   */
  const timelineAds: PageAd[] = mixedAds.map((ad) => ({
    ...ad, id: ad.id.replace(/^71/, "72"),
  }));

  writeFileSync(join(TMP, "pages-timeline-a.json"), JSON.stringify(pageExport({
    pageId: "720000000000001", pageName: "คลินิกไทม์ไลน์ P2", likeCount: 5100,
    generatedAt: "2026-09-01T00:00:00.000Z", query: "วิตามินทดสอบ", ads: timelineAds,
  })));

  writeFileSync(join(TMP, "pages-timeline-b.json"), JSON.stringify(pageExport({
    pageId: "720000000000001", pageName: "คลินิกไทม์ไลน์ P2", likeCount: 5480,
    generatedAt: "2026-09-06T00:00:00.000Z", query: "คอลลาเจนทดสอบ",
    ads: [
      { ...timelineAds[0], is_active: false },
      timelineAds[1],
      { ...timelineAds[2], is_active: null, display_format: null },
      timelineAds[3],
      timelineAds[4],
      { id: "720000000000106", is_active: true, display_format: "VIDEO", cta_type: "MESSAGE_PAGE",
        publisher_platform: ["FACEBOOK", "INSTAGRAM"], collation_count: 3,
        start: "2026-09-02T00:00:00.000Z" },
    ],
  })));

  /*
   * The category-workspace pair: two pages, two runs, its own page ids.
   *
   * A category ranks pages against each other, so one page would prove nothing;
   * and it aggregates every dataset in its category, so it gets ids of its own
   * rather than sharing them with the page and timeline specs.
   *
   * Between the runs one ad stops, one becomes unreadable, one is new, and the
   * query changes — which is what makes the comparability caveat appear.
   */
  const categoryAds = (prefix: string): PageAd[] => mixedAds.map((ad) => ({
    ...ad, id: ad.id.replace(/^710/, prefix),
  }));

  const twoPageExport = (options: {
    generatedAt: string; query: string;
    pages: { pageId: string; pageName: string; ads: PageAd[] }[];
  }) => {
    const parts = options.pages.map((entry) => pageExport({
      pageId: entry.pageId, pageName: entry.pageName, likeCount: 3200,
      generatedAt: options.generatedAt, query: options.query, ads: entry.ads,
    }));
    const ads = parts.flatMap((part) => part.ads);
    return {
      ...parts[0],
      ads,
      source_rows: ads.length, unique_ads: ads.length,
      unique_pages: options.pages.length,
      quality_summary: {
        ...golden.quality_summary, resolved_records: ads.length, unresolved_records: 0,
      },
    };
  };

  const catPageA = categoryAds("731");
  const catPageB = categoryAds("732").slice(0, 3);

  writeFileSync(join(TMP, "category-run-a.json"), JSON.stringify(twoPageExport({
    generatedAt: "2026-09-01T00:00:00.000Z", query: "คลินิกทดสอบ",
    pages: [
      { pageId: "730000000000001", pageName: "คลินิกหมวด A", ads: catPageA },
      { pageId: "730000000000002", pageName: "คลินิกหมวด B", ads: catPageB },
    ],
  })));

  writeFileSync(join(TMP, "category-run-b.json"), JSON.stringify(twoPageExport({
    generatedAt: "2026-09-06T00:00:00.000Z", query: "ฟิลเลอร์ทดสอบ",
    pages: [
      {
        pageId: "730000000000001", pageName: "คลินิกหมวด A",
        ads: [
          { ...catPageA[0], is_active: false },
          catPageA[1],
          { ...catPageA[2], is_active: null, display_format: null },
          catPageA[3],
          catPageA[4],
          { id: "731000000000106", is_active: true, display_format: "VIDEO",
            cta_type: "MESSAGE_PAGE", publisher_platform: ["FACEBOOK", "INSTAGRAM"],
            collation_count: 3, start: "2026-09-02T00:00:00.000Z" },
        ],
      },
      { pageId: "730000000000002", pageName: "คลินิกหมวด B", ads: catPageB },
    ],
  })));

  /*
   * The trends pair: the same two pages, collected twice, far enough apart to
   * land in two different comparison windows.
   *
   * These generated_at values are RELATIVE TO NOW, because a trend compares the
   * last N days with the N before them — pinned dates would drift out of both
   * windows within a month and the spec would be testing an empty screen.
   *
   * Between the two collections one ad stops, one becomes unreadable, one is
   * new, and the query changes, so every part of the surface has something real
   * to report.
   */
  const DAY = 86_400_000;
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

  const trendAds: PageAd[] = mixedAds.map((ad) => ({ ...ad, id: ad.id.replace(/^710/, "741") }));
  const trendPageB: PageAd[] = mixedAds.slice(0, 2).map((ad) => ({
    ...ad, id: ad.id.replace(/^710/, "742"),
  }));

  writeFileSync(join(TMP, "trends-old.json"), JSON.stringify(twoPageExport({
    // Inside the previous window for every offered period length.
    generatedAt: daysAgo(45), query: "กันแดดทดสอบ",
    pages: [
      { pageId: "740000000000001", pageName: "แบรนด์แนวโน้ม A", ads: trendAds },
      { pageId: "740000000000002", pageName: "แบรนด์แนวโน้ม B", ads: trendPageB },
    ],
  })));

  writeFileSync(join(TMP, "trends-new.json"), JSON.stringify(twoPageExport({
    // Inside the current window for every offered period length.
    generatedAt: daysAgo(2), query: "ครีมกันแดดทดสอบ",
    pages: [
      {
        pageId: "740000000000001", pageName: "แบรนด์แนวโน้ม A",
        ads: [
          { ...trendAds[0], is_active: false },
          trendAds[1],
          { ...trendAds[2], is_active: null, display_format: null },
          trendAds[3],
          trendAds[4],
          // Started and first seen inside the current window: an event in one
          // period and in neither of the others.
          { id: "741000000000106", is_active: true, display_format: "VIDEO",
            cta_type: "MESSAGE_PAGE", publisher_platform: ["FACEBOOK", "INSTAGRAM"],
            collation_count: 3, start: daysAgo(5) },
        ],
      },
      { pageId: "740000000000002", pageName: "แบรนด์แนวโน้ม B", ads: trendPageB },
    ],
  })));

  /*
   * The watchlist baseline: one page, collected before any watch exists.
   *
   * Every ad here is IMAGE / LEARN_MORE on purpose. The spec saves a watch
   * against this run and then imports a second one built at test time — so the
   * later collection is genuinely after the baseline, which is the only way the
   * signals can be exercised honestly. A fixture written now and imported later
   * would sit before the baseline and prove nothing.
   */
  const watchAds: PageAd[] = [
    { id: "750000000000101", is_active: true, display_format: "IMAGE", cta_type: "LEARN_MORE",
      publisher_platform: ["FACEBOOK"], collation_count: 1, start: "2021-02-01T00:00:00.000Z" },
    { id: "750000000000102", is_active: true, display_format: "IMAGE", cta_type: "LEARN_MORE",
      publisher_platform: ["FACEBOOK"], collation_count: 2, start: "2026-06-01T00:00:00.000Z" },
    { id: "750000000000103", is_active: true, display_format: "IMAGE", cta_type: null,
      publisher_platform: ["INSTAGRAM"], collation_count: 1, start: "2026-07-15T00:00:00.000Z" },
  ];

  writeFileSync(join(TMP, "watch-old.json"), JSON.stringify(pageExport({
    pageId: "750000000000001", pageName: "คลินิกติดตาม P2", likeCount: 2750,
    generatedAt: daysAgo(30), query: "วิตามินผิวทดสอบ", ads: watchAds,
  })));

  /*
   * The brand-mapping fixture: three pages in one collection.
   *
   * Three, because the queue has to be a queue — one row proves nothing about
   * ordering, and a Brand that holds two Pages is the case the whole feature
   * exists for. Two of them share a display name on purpose: the mapper must
   * disambiguate by page_id, never by what is on screen.
   */
  const brandAds = (prefix: string, count: number): PageAd[] =>
    mixedAds.slice(0, count).map((ad) => ({ ...ad, id: ad.id.replace(/^710/, prefix) }));

  writeFileSync(join(TMP, "brand-pages.json"), JSON.stringify(twoPageExport({
    generatedAt: daysAgo(6), query: "กาแฟทดสอบ",
    pages: [
      { pageId: "760000000000001", pageName: "กาแฟกลอรี่ สาขาหลัก", ads: brandAds("761", 4) },
      { pageId: "760000000000002", pageName: "กาแฟกลอรี่ สาขาหลัก", ads: brandAds("762", 3) },
    ],
  })));

  writeFileSync(join(TMP, "brand-pages-2.json"), JSON.stringify(pageExport({
    pageId: "760000000000003", pageName: "คู่แข่งกาแฟ ทดสอบ", likeCount: 1200,
    generatedAt: daysAgo(4), query: "กาแฟทดสอบ", ads: brandAds("763", 2),
  })));

  writeFileSync(join(TMP, "invalid.json"), "{ this is not json");
}
