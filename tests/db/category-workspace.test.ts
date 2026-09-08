import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import type { CanonicalImport } from "../../lib/domain/types.ts";
import { connect, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * The category workspace read layer (migration 0028).
 *
 * Three things are pinned here, and each of them would be invisible if it broke:
 *
 *   1. distinct ads — an ad collected into three datasets of a category is one
 *      ad, in every current-view figure
 *   2. two layers — the overview reduces to the latest observation per ad, the
 *      activity chart does not, and a regression test guards the difference
 *   3. reconciliation — every count opens exactly the ads it counted
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const PAGES_ARGS = "$1, $2, $3, $4, $5, $6";
const EVIDENCE_ARGS = "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13";

const DAY = 86_400_000;
const RUN_ONE = new Date(Date.now() - 20 * DAY).toISOString();
const RUN_TWO = new Date(Date.now() - 2 * DAY).toISOString();

const PAGE_A = "940000000000001";
const PAGE_B = "940000000000002";

type AdSpec = {
  id: string; pageId: string; startDate: string;
  isActive: boolean | null; format: string | null; cta: string | null;
  collation?: number; platforms?: string[];
};

/** One collection run holding whatever ads the case needs. */
function runCanonical(options: {
  collectedAt: string; ads: AdSpec[]; query?: string; country?: string;
}): CanonicalImport {
  const first = options.ads[0];
  const canonical = singleAdCanonical({
    collectedAt: options.collectedAt, pageId: first.pageId, adArchiveId: first.id,
  });
  const [ad] = canonical.ads;
  const [observation] = canonical.adObservations;
  const [pageObservation] = canonical.pageObservations;

  canonical.run.scope = {
    ...canonical.run.scope,
    query: options.query ?? "วิตามิน",
    country: options.country ?? "TH",
  };

  const pageIds = [...new Set(options.ads.map((entry) => entry.pageId))];
  canonical.pages = pageIds.map((pageId) => ({
    pageId, pageProfileNumericId: null, pageProfileUri: null,
  }));
  canonical.pageObservations = pageIds.map((pageId) => ({
    ...pageObservation,
    pageId,
    pageName: pageId === PAGE_A ? "เพจ A" : "เพจ B",
    pageCategories: ["Health/beauty", "Medical Center"],
  }));

  canonical.ads = [];
  canonical.adObservations = [];
  for (const entry of options.ads) {
    canonical.ads.push({
      ...ad,
      adArchiveId: entry.id,
      pageId: entry.pageId,
      startDate: entry.startDate,
      isActive: entry.isActive,
      displayFormat: entry.format,
      publisherPlatform: entry.platforms ?? ["FACEBOOK"],
    });
    canonical.adObservations.push({
      ...observation,
      adArchiveId: entry.id,
      isActive: entry.isActive,
      displayFormat: entry.format,
      publisherPlatform: entry.platforms ?? ["FACEBOOK"],
      ctaType: entry.cta,
      collationCount: entry.collation ?? 1,
      provenance: { ...observation.provenance, recordKey: `ad:${entry.id}` },
    });
  }

  const total = canonical.ads.length;
  canonical.run.reported = {
    ...canonical.run.reported, sourceRows: total, uniqueAds: total, uniquePages: pageIds.length,
  };
  canonical.run.computed = {
    sourceRows: total, uniqueAds: total, uniquePages: pageIds.length, unresolvedCount: 0,
  };
  return canonical;
}

const OLD_ACTIVE: AdSpec = {
  id: "940000000000101", pageId: PAGE_A, startDate: "2020-02-01T00:00:00.000Z",
  isActive: true, format: "VIDEO", cta: "MESSAGE_PAGE", collation: 6,
  platforms: ["FACEBOOK", "INSTAGRAM"],
};
const RECENT_START: AdSpec = {
  id: "940000000000102", pageId: PAGE_A, startDate: new Date(Date.now() - 4 * DAY).toISOString(),
  isActive: true, format: "IMAGE", cta: "LEARN_MORE",
};
const NO_CTA: AdSpec = {
  id: "940000000000103", pageId: PAGE_B, startDate: "2021-01-01T00:00:00.000Z",
  isActive: false, format: "IMAGE", cta: null, collation: 2,
};
const UNREADABLE: AdSpec = {
  id: "940000000000104", pageId: PAGE_B, startDate: "2019-05-01T00:00:00.000Z",
  isActive: null, format: null, cta: null,
};

test("category workspace read layer", { skip, concurrency: 1 }, async (t) => {
  const client = await connect();
  await resetTables(client);

  const category = await seedCategory(client, "cw-main");
  const otherCategory = await seedCategory(client, "cw-other");

  // Run one: all four ads, everything active that will later change.
  await commitImport({
    canonical: runCanonical({
      collectedAt: RUN_ONE,
      ads: [
        OLD_ACTIVE,
        { ...RECENT_START, isActive: true },
        { ...NO_CTA, isActive: true },
        { ...UNREADABLE, isActive: true },
      ],
    }),
    categoryId: category, datasetName: "cw-run-one", actorId: null,
  });

  // Run two, same category: the same four ads seen again, now in their final
  // states, under a different query.
  await commitImport({
    canonical: runCanonical({
      collectedAt: RUN_TWO, query: "คอลลาเจน",
      ads: [OLD_ACTIVE, RECENT_START, NO_CTA, UNREADABLE],
    }),
    categoryId: category, datasetName: "cw-run-two", actorId: null,
  });

  // A different category with its own page, so scope boundaries have something
  // to leak across.
  await commitImport({
    canonical: runCanonical({
      collectedAt: RUN_ONE,
      ads: [{
        id: "940000000000201", pageId: "940000000000003",
        startDate: "2022-01-01T00:00:00.000Z", isActive: true, format: "IMAGE", cta: null,
      }],
    }),
    categoryId: otherCategory, datasetName: "cw-other-run", actorId: null,
  });

  const detail = (categoryId: string, days = 30) =>
    client.query("select * from public.category_detail($1, $2)", [categoryId, days]);

  const ranking = (categoryId: string, sort = "observed_ads", search: string | null = null) =>
    client.query(
      `select * from public.category_pages(${PAGES_ARGS})`,
      [categoryId, 30, search, sort, 25, 0],
    );

  const evidence = (categoryId: string, args: {
    signal?: string | null; format?: string | null; cta?: string | null;
    platform?: string | null; pageId?: string | null;
    windowMetric?: string | null; from?: string | null; to?: string | null;
  } = {}) => client.query(
    `select * from public.category_evidence(${EVIDENCE_ARGS})`,
    [categoryId, args.signal ?? null, 30, args.format ?? null, args.cta ?? null,
     args.platform ?? null, args.pageId ?? null, args.windowMetric ?? null,
     args.from ?? null, args.to ?? null, "started_desc", 200, 0],
  );

  await t.test("an ad in two datasets of a category is counted once", async () => {
    const { rows } = await detail(category);
    // Four ads, collected twice. Eight observations, four ads.
    assert.equal(Number(rows[0].observed_ads), 4);
    assert.equal(Number(rows[0].observed_pages), 2);
    assert.equal(Number(rows[0].dataset_count), 2);
    assert.equal(Number(rows[0].run_count), 2);
  });

  await t.test("the current view is the latest observation of each ad", async () => {
    const { rows } = await detail(category);
    // Run two saw one ad stopped and one unreadable. The overview reports the
    // latest, not the first, and not a mixture.
    assert.equal(Number(rows[0].active_ads), 2);
    assert.equal(Number(rows[0].inactive_ads), 1);
    assert.equal(Number(rows[0].unknown_ads), 1);
    assert.equal(
      Number(rows[0].active_ads) + Number(rows[0].inactive_ads) + Number(rows[0].unknown_ads),
      Number(rows[0].observed_ads),
      "the three states must partition the observed ads exactly",
    );
  });

  await t.test("recently found and started recently stay different numbers", async () => {
    const { rows } = await detail(category);
    // Every ad was first observed by us during this test; only one started
    // inside the window according to Meta.
    assert.equal(Number(rows[0].recently_found), 4);
    assert.equal(Number(rows[0].started_recently), 1);
  });

  await t.test("evergreen uses the centralized threshold and exposes it", async () => {
    const { rows } = await detail(category);
    assert.equal(Number(rows[0].evergreen_threshold_days), 90);
    // Only the 2020 ad is both active and old enough. The 2019 one is old but
    // its state is unreadable, and unknown is not active.
    assert.equal(Number(rows[0].evergreen_ads), 1);
  });

  await t.test("a category never reads another category's data", async () => {
    const mine = await ranking(category);
    const theirs = await ranking(otherCategory);
    assert.deepEqual(mine.rows.map((row) => row.page_id).sort(), [PAGE_A, PAGE_B]);
    assert.deepEqual(theirs.rows.map((row) => row.page_id), ["940000000000003"]);
    assert.equal(Number(theirs.rows[0].share_denominator), 1);
  });

  await t.test("the ranking's denominator is the whole category, not the filter", async () => {
    const all = await ranking(category);
    assert.equal(Number(all.rows[0].share_denominator), 4);

    const searched = await ranking(category, "observed_ads", "เพจ A");
    assert.equal(searched.rows.length, 1);
    // Searching narrows the rows, never the denominator: a share of a search
    // result is a share of nothing.
    assert.equal(Number(searched.rows[0].share_denominator), 4);
    assert.equal(Number(searched.rows[0].total_count), 1);
  });

  await t.test("ranking sorts are keys, and an unknown key falls back", async () => {
    const byName = await ranking(category, "page_name");
    assert.deepEqual(byName.rows.map((row) => row.page_name), ["เพจ A", "เพจ B"]);
    // Not an injection vector: the value is compared, never interpolated.
    const nonsense = await ranking(category, "page_name; drop table ads");
    assert.equal(nonsense.rows.length, 2);
  });

  await t.test("the activity chart does not use the current-view reduction", async () => {
    const { rows } = await client.query(
      "select * from public.category_activity($1, $2, null, null)",
      [category, "week"],
    );
    const started = rows.reduce((sum, row) => sum + Number(row.started_ads), 0);
    const firstSeen = rows.reduce((sum, row) => sum + Number(row.first_seen_ads), 0);
    // Four distinct ads in each series — the ads themselves, read once, not the
    // eight observations and not the four reduced rows.
    assert.equal(started, 4);
    assert.equal(firstSeen, 4);
    // ...and they land in different buckets, because they are different clocks.
    const startedOnly = rows.filter((row) => Number(row.started_ads) > 0 && Number(row.first_seen_ads) === 0);
    assert.ok(startedOnly.length >= 2, "old starts nobody had seen yet");
  });

  await t.test("run history keeps what each run saw, one row per run", async () => {
    const { rows } = await client.query(
      "select * from public.category_run_history($1)", [category],
    );
    assert.equal(rows.length, 2);
    const [two, one] = rows;
    // Run one saw everything active. That is still true of run one, however the
    // ads look now.
    assert.equal(Number(one.observed_ads), 4);
    assert.equal(Number(one.active_ads), 4);
    assert.equal(Number(two.active_ads), 2);
    assert.equal(Number(two.unknown_ads), 1);
    assert.equal(Number(one.observed_pages), 2);
  });

  await t.test("contributing datasets carry the query that produced them", async () => {
    const { rows } = await client.query(
      "select * from public.category_datasets($1)", [category],
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(
      [...new Set(rows.map((row) => row.scope_query))].sort(),
      ["คอลลาเจน", "วิตามิน"],
    );
    assert.ok(rows.every((row) => row.run_status === "completed"));
  });

  await t.test("the creative mix carries its own denominators", async () => {
    const { rows } = await client.query(
      "select * from public.category_creative_mix($1)", [category],
    );
    const formats = rows.filter((row) => row.dimension === "display_format");
    assert.equal(formats.reduce((sum, row) => sum + Number(row.n), 0), 4);
    assert.equal(Number(formats[0].observed), 4);
    // One ad has no readable format, so coverage is three of four.
    assert.equal(Number(formats[0].covered), 3);

    const cta = rows.filter((row) => row.dimension === "cta_type");
    assert.equal(Number(cta[0].covered), 2);
    assert.equal(Number(cta[0].observed), 4);

    const platforms = rows.filter((row) => row.dimension === "publisher_platform");
    assert.ok(platforms.every((row) => row.exclusive === false));
    assert.ok(
      platforms.reduce((sum, row) => sum + Number(row.n), 0) > 4,
      "one ad on two platforms counts twice — this is why it is not a pie",
    );

    // Meta's own page label is returned under its own dimension name, so a
    // caller cannot mistake it for the research category.
    const pageCategories = rows.filter((row) => row.dimension === "page_category");
    assert.ok(pageCategories.length > 0);
    assert.ok(pageCategories.every((row) => row.exclusive === false));
  });

  /* ------------------------------------------------------ reconciliation */

  await t.test("the overview's observed ads open exactly", async () => {
    const summary = await detail(category);
    const ads = await evidence(category);
    assert.equal(ads.rows.length, Number(summary.rows[0].observed_ads));
    assert.equal(Number(ads.rows[0].total_count), 4);
  });

  await t.test("every signal count opens exactly the ads it counted", async () => {
    const summary = (await detail(category)).rows[0];
    const cases: [string, number][] = [
      ["recent", Number(summary.recently_found)],
      ["started_recently", Number(summary.started_recently)],
      ["evergreen", Number(summary.evergreen_ads)],
      ["reused", Number(summary.reused_ads)],
      ["active", Number(summary.active_ads)],
      ["inactive", Number(summary.inactive_ads)],
      ["unknown", Number(summary.unknown_ads)],
    ];
    for (const [signal, expected] of cases) {
      const ads = await evidence(category, { signal });
      assert.equal(ads.rows.length, expected, `${signal} claimed ${expected}, returned ${ads.rows.length}`);
    }
  });

  await t.test("every page in the ranking opens exactly its ads", async () => {
    const { rows } = await ranking(category);
    for (const row of rows) {
      const ads = await evidence(category, { pageId: row.page_id });
      assert.equal(ads.rows.length, Number(row.observed_ads));
    }
  });

  await t.test("every mix bucket opens exactly the ads it counted", async () => {
    const { rows } = await client.query(
      "select * from public.category_creative_mix($1)", [category],
    );
    for (const row of rows) {
      if (row.value === "—") continue; // the unreadable bucket is not filterable
      const key =
        row.dimension === "display_format" ? { format: row.value }
        : row.dimension === "cta_type" ? { cta: row.value }
        : row.dimension === "publisher_platform" ? { platform: row.value }
        : null;
      if (!key) continue; // Meta's page categories are metadata, not an ad filter
      const ads = await evidence(category, key);
      assert.equal(
        ads.rows.length, Number(row.n),
        `${row.dimension}=${row.value} claimed ${row.n}, returned ${ads.rows.length}`,
      );
    }
  });

  await t.test("every activity bucket opens exactly the ads it counted", async () => {
    const { rows } = await client.query(
      "select * from public.category_activity($1, $2, null, null)", [category, "day"],
    );
    for (const row of rows) {
      const from = new Date(row.bucket_start).toISOString();
      const to = new Date(new Date(row.bucket_start).getTime() + DAY).toISOString();
      for (const [metric, expected] of [
        ["started", Number(row.started_ads)], ["first_seen", Number(row.first_seen_ads)],
      ] as const) {
        if (expected === 0) continue;
        const ads = await evidence(category, { windowMetric: metric, from, to });
        assert.equal(ads.rows.length, expected, `${metric} bucket ${from}`);
      }
    }
  });

  await t.test("an empty category answers truthfully rather than failing", async () => {
    const empty = await seedCategory(client, "cw-empty");
    const summary = await detail(empty);
    assert.equal(summary.rows.length, 1, "the category exists even with no data");
    assert.equal(Number(summary.rows[0].observed_ads), 0);
    assert.equal(Number(summary.rows[0].dataset_count), 0);
    assert.equal((await ranking(empty)).rows.length, 0);
    assert.equal((await evidence(empty)).rows.length, 0);
  });

  await t.test("every category function is invoker-rights and denied to anon", async () => {
    const names = [
      "category_list", "category_detail", "category_datasets", "category_pages",
      "category_creative_mix", "category_activity", "category_run_history",
      "category_evidence",
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
