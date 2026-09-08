import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import type { CanonicalImport } from "../../lib/domain/types.ts";
import { connect, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * The Page Intelligence read layer (migration 0026).
 *
 * The cases below pin the two things that would make this feature dishonest if
 * they broke quietly: that a scope means exactly what it says, and that the
 * three definitions of "recent" stay three different numbers.
 *
 * Everything runs against the real database, because the whole feature is SQL.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const LIST_ARGS = "$1, $2, $3, $4, $5, $6, $7, $8, $9";
const ADS_ARGS = "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11";

type ListArgs = {
  search?: string | null; active?: string | null; category?: string | null;
  recentDays?: number; sort?: string; limit?: number; offset?: number;
};

const listParams = (scope: string, scopeId: string | null, a: ListArgs = {}) => [
  scope, scopeId, a.search ?? null, a.active ?? null, a.category ?? null,
  a.recentDays ?? 30, a.sort ?? "observed_ads", a.limit ?? 30, a.offset ?? 0,
];

/**
 * One page with four ads that differ in exactly the ways the signals ask about:
 * an old runner, a brand-new start, an inactive one and one with no readable
 * state at all.
 */
function pageCanonical(options: {
  collectedAt: string;
  pageId?: string;
  pageName?: string;
  likeCount?: number;
  /** ad_archive_id is unique across the product, so a second page needs its own. */
  adPrefix?: string;
}): CanonicalImport {
  const pageId = options.pageId ?? "910000000000001";
  const prefix = options.adPrefix ?? "90000000000000";
  const canonical = singleAdCanonical({
    collectedAt: options.collectedAt, pageId, adArchiveId: `${prefix}1`,
  });
  const [page] = canonical.pages;
  const [pageObservation] = canonical.pageObservations;
  const [ad] = canonical.ads;
  const [observation] = canonical.adObservations;

  page.pageProfileUri = "https://www.facebook.com/61550000000000/";
  pageObservation.pageName = options.pageName ?? "เพจทดสอบ";
  pageObservation.pageLikeCount = options.likeCount ?? 1000;
  pageObservation.pageCategories = ["Health/beauty", "Product/service"];

  // Ad 1 — running for years, active: evergreen by definition.
  ad.startDate = "2020-01-01T00:00:00.000Z";
  ad.isActive = true;
  ad.displayFormat = "VIDEO";
  ad.publisherPlatform = ["FACEBOOK", "INSTAGRAM"];
  observation.isActive = true;
  observation.displayFormat = "VIDEO";
  observation.publisherPlatform = ["FACEBOOK", "INSTAGRAM"];
  observation.ctaType = "MESSAGE_PAGE";
  observation.collationCount = 5;

  const variants = [
    // Ad 2 — started days ago, active, image: recent by Meta's date.
    {
      id: `${prefix}2`,
      startDate: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      isActive: true, format: "IMAGE", cta: "LEARN_MORE", collation: 1,
      platforms: ["FACEBOOK", "MESSENGER"],
    },
    // Ad 3 — old and stopped: not evergreen, and not unknown either.
    {
      id: `${prefix}3`,
      startDate: "2021-01-01T00:00:00.000Z",
      isActive: false, format: "IMAGE", cta: null, collation: 3,
      platforms: ["INSTAGRAM"],
    },
    // Ad 4 — state unreadable. Its own answer, never counted as inactive.
    {
      id: `${prefix}4`,
      startDate: "2019-06-01T00:00:00.000Z",
      isActive: null, format: null, cta: null, collation: 1,
      platforms: [],
    },
  ];

  for (const variant of variants) {
    canonical.ads.push({
      ...ad,
      adArchiveId: variant.id,
      startDate: variant.startDate,
      isActive: variant.isActive,
      displayFormat: variant.format,
      publisherPlatform: variant.platforms,
    });
    canonical.adObservations.push({
      ...observation,
      adArchiveId: variant.id,
      isActive: variant.isActive,
      displayFormat: variant.format,
      publisherPlatform: variant.platforms,
      ctaType: variant.cta,
      collationCount: variant.collation,
      provenance: { ...observation.provenance, recordKey: `ad:${variant.id}` },
    });
  }

  const total = canonical.ads.length;
  canonical.run.reported = {
    ...canonical.run.reported, sourceRows: total, uniqueAds: total, uniquePages: 1,
  };
  canonical.run.computed = { sourceRows: total, uniqueAds: total, uniquePages: 1, unresolvedCount: 0 };
  return canonical;
}

/*
 * Collection times relative to now, because "recently found" is measured
 * against the clock. Pinned ISO dates would make these cases pass in 2026 and
 * fail every day after.
 */
const DAY = 86_400_000;
const OBSERVED_A = new Date(Date.now() - 20 * DAY).toISOString();
const OBSERVED_B = new Date(Date.now() - 2 * DAY).toISOString();
const OBSERVED_C = new Date(Date.now() - 10 * DAY).toISOString();

test("page intelligence read layer", { skip, concurrency: 1 }, async (t) => {
  const client = await connect();
  await resetTables(client);

  const categoryA = await seedCategory(client, "pi-a");
  const categoryB = await seedCategory(client, "pi-b");

  const runA = await commitImport({
    canonical: pageCanonical({ collectedAt: OBSERVED_A, likeCount: 1000 }),
    categoryId: categoryA, datasetName: "pi-dataset-a", actorId: null,
  });

  // A second run of the SAME page, later, in the same category: this is what
  // makes "latest observation in scope" observable.
  const later = pageCanonical({ collectedAt: OBSERVED_B, likeCount: 2500 });
  later.adObservations[0].isActive = false;
  later.ads[0].isActive = false;
  const runB = await commitImport({
    canonical: later, categoryId: categoryA, datasetName: "pi-dataset-b", actorId: null,
  });

  // A different page in a different category, so scope boundaries have
  // something to leak across if they are wrong.
  const other = pageCanonical({
    collectedAt: OBSERVED_C, pageId: "910000000000002", pageName: "เพจอื่น",
    adPrefix: "92000000000000",
  });
  const runC = await commitImport({
    canonical: other, categoryId: categoryB, datasetName: "pi-dataset-c", actorId: null,
  });

  const list = (scope: string, scopeId: string | null, args: ListArgs = {}) =>
    client.query(`select * from public.page_list(${LIST_ARGS})`, listParams(scope, scopeId, args));

  const detail = (scope: string, scopeId: string | null, pageId: string, days = 30) =>
    client.query("select * from public.page_detail($1, $2, $3, $4)", [scope, scopeId, pageId, days]);

  await t.test("dataset scope reads that dataset's own run, not the newest", async () => {
    // Run A saw the first ad active; run B saw it stopped. Dataset A must still
    // report what run A observed — Snapshot Truth, at page level.
    const a = await detail("dataset", runA.datasetId, "910000000000001");
    const b = await detail("dataset", runB.datasetId, "910000000000001");

    assert.equal(Number(a.rows[0].observed_ads), 4);
    assert.equal(Number(a.rows[0].active_ads), 2, "run A saw two active ads");
    assert.equal(Number(b.rows[0].active_ads), 1, "run B saw the evergreen ad stopped");
    assert.equal(Number(a.rows[0].inactive_ads), 1);
    assert.equal(Number(b.rows[0].inactive_ads), 2);
    // Unknown is unknown in both, and is never folded into inactive.
    assert.equal(Number(a.rows[0].unknown_ads), 1);
    assert.equal(Number(b.rows[0].unknown_ads), 1);
  });

  await t.test("category scope uses the latest observation of each ad", async () => {
    const rows = await detail("category", categoryA, "910000000000001");
    // Both runs are in scope, so the ad's state is the one run B saw.
    assert.equal(Number(rows.rows[0].observed_ads), 4);
    assert.equal(Number(rows.rows[0].active_ads), 1);
    assert.equal(Number(rows.rows[0].runs_in_scope), 2, "both runs saw this page");
    // ...and the page's own facts come from the newest observation too.
    assert.equal(Number(rows.rows[0].page_like_count), 2500);
  });

  await t.test("a scope never leaks across a category boundary", async () => {
    const inA = await list("category", categoryA);
    const inB = await list("category", categoryB);
    assert.deepEqual(inA.rows.map((row) => row.page_id), ["910000000000001"]);
    assert.deepEqual(inB.rows.map((row) => row.page_id), ["910000000000002"]);

    // A page that exists, asked for in the wrong scope, is absent — not
    // silently answered from the wider set.
    const wrong = await detail("category", categoryB, "910000000000001");
    assert.equal(Number(wrong.rows[0]?.observed_ads ?? 0), 0);

    const all = await list("all", null);
    assert.equal(all.rows.length, 2, "all scope holds both pages");
  });

  await t.test("recently found and started recently are different numbers", async () => {
    const rows = await detail("category", categoryA, "910000000000001", 30);
    // Every ad was first observed by us during this test run, so all four are
    // "recently found" — while only one of them actually started recently.
    assert.equal(Number(rows.rows[0].recently_found), 4);
    assert.equal(Number(rows.rows[0].started_recently), 1);
    assert.notEqual(
      Number(rows.rows[0].recently_found),
      Number(rows.rows[0].started_recently),
      "first_seen_at and start_date must not be the same fact",
    );
  });

  await t.test("evergreen needs both halves: still running and old enough", async () => {
    // Run A: the 2020 ad is active and far past the threshold.
    const a = await detail("dataset", runA.datasetId, "910000000000001");
    assert.equal(Number(a.rows[0].evergreen_ads), 1);

    // Run B saw that same ad stopped, so it is no longer evergreen even though
    // it is just as old. Age alone was never the rule.
    const b = await detail("dataset", runB.datasetId, "910000000000001");
    assert.equal(Number(b.rows[0].evergreen_ads), 0);
  });

  await t.test("reuse counts ads collated with others, and reports the peak", async () => {
    const rows = await detail("dataset", runA.datasetId, "910000000000001");
    assert.equal(Number(rows.rows[0].reused_ads), 2, "collation_count > 1");
    assert.equal(Number(rows.rows[0].max_collation), 5);
  });

  await t.test("first and last observed come from the collection runs in scope", async () => {
    const single = await list("dataset", runA.datasetId);
    assert.equal(new Date(single.rows[0].first_observed_at).toISOString(), OBSERVED_A);
    assert.equal(
      new Date(single.rows[0].last_observed_at).toISOString(),
      OBSERVED_A,
      "one run in scope means first and last are the same moment",
    );

    // In the wider scope the page spans both runs — and the value is the run's
    // collected_at, never the ad's start date.
    const wide = await list("category", categoryA);
    assert.equal(new Date(wide.rows[0].first_observed_at).toISOString(), OBSERVED_A);
    assert.equal(new Date(wide.rows[0].last_observed_at).toISOString(), OBSERVED_B);
  });

  await t.test("the active filter selects pages, and does not restate their counts", async () => {
    const active = await list("dataset", runA.datasetId, { active: "active" });
    assert.equal(active.rows.length, 1);
    // The page qualifies because it HAS active ads; its observed_ads is still
    // every ad in scope, not just the active ones.
    assert.equal(Number(active.rows[0].observed_ads), 4);

    const unknown = await list("dataset", runA.datasetId, { active: "unknown" });
    assert.equal(unknown.rows.length, 1, "a page with an unreadable-state ad is findable");
  });

  await t.test("search matches a name or an exact page id, and nothing else", async () => {
    assert.equal((await list("all", null, { search: "เพจทดสอบ" })).rows.length, 1);
    assert.equal((await list("all", null, { search: "910000000000002" })).rows.length, 1);
    assert.equal((await list("all", null, { search: "ไม่มีเพจนี้" })).rows.length, 0);
  });

  await t.test("the list paginates and totals server-side", async () => {
    const first = await list("all", null, { limit: 1, offset: 0 });
    const second = await list("all", null, { limit: 1, offset: 1 });
    assert.equal(first.rows.length, 1);
    assert.equal(second.rows.length, 1);
    assert.notEqual(first.rows[0].page_id, second.rows[0].page_id);
    // The denominator is the filtered set, not the page.
    assert.equal(Number(first.rows[0].total_count), 2);
  });

  await t.test("sorts are keys, and an unknown key falls back to the default", async () => {
    const byName = await list("all", null, { sort: "page_name" });
    assert.deepEqual(
      byName.rows.map((row) => row.page_name),
      [...byName.rows.map((row) => row.page_name)].sort((a, b) => a.localeCompare(b)),
    );
    // Not an injection vector: the value is compared, never interpolated.
    const nonsense = await list("all", null, { sort: "page_name; drop table ads" });
    assert.equal(nonsense.rows.length, 2);
  });

  await t.test("creative mix carries its own denominators", async () => {
    const { rows } = await client.query(
      "select * from public.page_creative_mix($1, $2, $3)",
      ["dataset", runA.datasetId, "910000000000001"],
    );

    const formats = rows.filter((row) => row.dimension === "display_format");
    // Four ads, one of which has no readable format: the '—' bucket exists and
    // the covered denominator excludes it.
    assert.equal(formats.reduce((sum, row) => sum + Number(row.n), 0), 4);
    assert.equal(Number(formats[0].observed), 4);
    assert.equal(Number(formats[0].covered), 3);
    assert.ok(formats.every((row) => row.exclusive === true));

    const cta = rows.filter((row) => row.dimension === "cta_type");
    // Two of four ads have a readable CTA. A distribution over those two is a
    // fact about them, and the denominator says so.
    assert.equal(Number(cta[0].covered), 2);
    assert.equal(Number(cta[0].observed), 4);

    const platforms = rows.filter((row) => row.dimension === "publisher_platform");
    assert.ok(platforms.every((row) => row.exclusive === false), "platform is multi-value");
    const platformTotal = platforms.reduce((sum, row) => sum + Number(row.n), 0);
    assert.ok(platformTotal > 4, "one ad on two platforms counts twice — this is why it is not a pie");
  });

  await t.test("activity keeps first-seen and started as separate series", async () => {
    const { rows } = await client.query(
      "select * from public.page_activity($1, $2, $3, $4)",
      ["dataset", runA.datasetId, "910000000000001", "week"],
    );
    const firstSeen = rows.reduce((sum, row) => sum + Number(row.first_seen_ads), 0);
    const started = rows.reduce((sum, row) => sum + Number(row.started_ads), 0);
    assert.equal(firstSeen, 4);
    assert.equal(started, 4);
    // The 2019/2020 starts and today's first sighting cannot share a bucket, so
    // the series must be spread across more than one.
    assert.ok(rows.length > 1, "start dates and first sightings land in different weeks");
  });

  await t.test("page likes are a history, never a sum", async () => {
    const { rows } = await client.query(
      "select * from public.page_like_history($1, $2, $3)",
      ["category", categoryA, "910000000000001"],
    );
    assert.equal(rows.length, 2, "one row per run that observed the page");
    // Newest first, and each row is the value observed in that run — 1000 and
    // 2500 are two observations, not 3500 followers.
    assert.equal(Number(rows[0].page_like_count), 2500);
    assert.equal(Number(rows[1].page_like_count), 1000);
  });

  await t.test("evidence returns the ads behind a signal, in scope", async () => {
    const ads = (signal: string | null) => client.query(
      `select * from public.page_ads(${ADS_ARGS})`,
      ["dataset", runA.datasetId, "910000000000001", signal, 30, null, null, null, "started_desc", 30, 0],
    );

    const all = await ads(null);
    assert.equal(all.rows.length, 4);
    assert.equal(Number(all.rows[0].total_count), 4);

    const evergreen = await ads("evergreen");
    assert.equal(evergreen.rows.length, 1);
    assert.equal(evergreen.rows[0].ad_archive_id, "900000000000001");

    const unknown = await ads("unknown");
    assert.equal(unknown.rows.length, 1);
    assert.equal(unknown.rows[0].is_active, null);

    // Every signal's evidence count must equal the number the summary showed.
    const summary = await detail("dataset", runA.datasetId, "910000000000001");
    assert.equal((await ads("reused")).rows.length, Number(summary.rows[0].reused_ads));
    assert.equal((await ads("recent")).rows.length, Number(summary.rows[0].recently_found));
  });

  await t.test("a page outside the scope has no evidence rows", async () => {
    const { rows } = await client.query(
      `select * from public.page_ads(${ADS_ARGS})`,
      ["dataset", runC.datasetId, "910000000000001", null, 30, null, null, null, "started_desc", 30, 0],
    );
    assert.equal(rows.length, 0, "the wrong dataset must not answer for this page");
  });

  await t.test("every read function is invoker-rights and denied to anon", async () => {
    const names = [
      "page_scope_observations", "page_list", "page_detail",
      "page_creative_mix", "page_activity", "page_like_history", "page_ads",
    ];
    for (const name of names) {
      const { rows } = await client.query(
        `select p.prosecdef,
                has_function_privilege('anon', p.oid, 'execute')          as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                p.proconfig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [name],
      );
      assert.equal(rows.length, 1, `${name} should exist exactly once`);
      assert.equal(rows[0].prosecdef, false, `${name} must stay SECURITY INVOKER`);
      assert.equal(rows[0].anon, false, `${name} must not be executable by anon`);
      assert.equal(rows[0].authenticated, true, `${name} must stay executable by authenticated`);
      assert.ok(
        (rows[0].proconfig ?? []).some((entry: string) => entry.startsWith("search_path=")),
        `${name} must pin its search_path`,
      );
    }
  });

  await client.end();
  await closePool();
});
