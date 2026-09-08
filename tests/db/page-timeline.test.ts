import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import type { CanonicalImport } from "../../lib/domain/types.ts";
import { connect, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * The Page timeline read layer (migration 0027).
 *
 * Two invariants carry this file. The first is that the three clocks stay
 * separate — a status series read off the latest-per-ad reduction would report
 * every ad as having always been in its newest state, which is the exact bug
 * these functions exist to avoid. The second is reconciliation: every count the
 * chart shows must be the same query as the evidence behind it, exactly.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const EVIDENCE_ARGS = "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10";

const DAY = 86_400_000;
const RUN_ONE = new Date(Date.now() - 20 * DAY).toISOString();
const RUN_TWO = new Date(Date.now() - 2 * DAY).toISOString();

const PAGE_ID = "930000000000001";

/**
 * One page across two runs.
 *
 * Run one sees three ads, all active. Run two sees four: the same three — one of
 * which has stopped and one whose state can no longer be read — plus a new one.
 * That is enough for every series here to have something to disagree about if
 * the sources were ever collapsed into one.
 */
function runCanonical(options: {
  collectedAt: string;
  ads: { id: string; startDate: string; isActive: boolean | null; format: string | null; cta: string | null }[];
  query?: string | null;
  country?: string | null;
}): CanonicalImport {
  const canonical = singleAdCanonical({
    collectedAt: options.collectedAt, pageId: PAGE_ID, adArchiveId: options.ads[0].id,
  });
  const [pageObservation] = canonical.pageObservations;
  const [ad] = canonical.ads;
  const [observation] = canonical.adObservations;

  pageObservation.pageName = "เพจไทม์ไลน์";
  canonical.run.scope = {
    ...canonical.run.scope,
    query: options.query ?? "วิตามิน",
    country: options.country ?? "TH",
  };

  const template = { ...ad };
  const templateObservation = { ...observation };
  canonical.ads = [];
  canonical.adObservations = [];

  for (const entry of options.ads) {
    canonical.ads.push({
      ...template,
      adArchiveId: entry.id,
      startDate: entry.startDate,
      isActive: entry.isActive,
      displayFormat: entry.format,
      publisherPlatform: ["FACEBOOK"],
    });
    canonical.adObservations.push({
      ...templateObservation,
      adArchiveId: entry.id,
      isActive: entry.isActive,
      displayFormat: entry.format,
      publisherPlatform: ["FACEBOOK"],
      ctaType: entry.cta,
      collationCount: 1,
      provenance: { ...templateObservation.provenance, recordKey: `ad:${entry.id}` },
    });
  }

  const total = canonical.ads.length;
  canonical.run.reported = {
    ...canonical.run.reported, sourceRows: total, uniqueAds: total, uniquePages: 1,
  };
  canonical.run.computed = { sourceRows: total, uniqueAds: total, uniquePages: 1, unresolvedCount: 0 };
  return canonical;
}

const AD_A = { id: "930000000000101", startDate: "2020-01-01T00:00:00.000Z" };
const AD_B = { id: "930000000000102", startDate: "2021-06-01T00:00:00.000Z" };
const AD_C = { id: "930000000000103", startDate: "2022-03-01T00:00:00.000Z" };
const AD_D = { id: "930000000000104", startDate: "2026-08-20T00:00:00.000Z" };

test("page timeline read layer", { skip, concurrency: 1 }, async (t) => {
  const client = await connect();
  await resetTables(client);

  const category = await seedCategory(client, "pt-timeline");

  const runOne = await commitImport({
    canonical: runCanonical({
      collectedAt: RUN_ONE,
      ads: [
        { ...AD_A, isActive: true, format: "VIDEO", cta: "MESSAGE_PAGE" },
        { ...AD_B, isActive: true, format: "IMAGE", cta: "LEARN_MORE" },
        { ...AD_C, isActive: true, format: "IMAGE", cta: null },
      ],
    }),
    categoryId: category, datasetName: "tl-run-one", actorId: null,
  });

  const runTwo = await commitImport({
    canonical: runCanonical({
      collectedAt: RUN_TWO,
      // A different query, so the comparability caveat has something real to
      // describe — and so the test proves the run identity is carried through.
      query: "คอลลาเจน",
      ads: [
        { ...AD_A, isActive: false, format: "VIDEO", cta: "MESSAGE_PAGE" },
        { ...AD_B, isActive: true, format: "IMAGE", cta: "LEARN_MORE" },
        { ...AD_C, isActive: null, format: "IMAGE", cta: null },
        { ...AD_D, isActive: true, format: "IMAGE", cta: null },
      ],
    }),
    categoryId: category, datasetName: "tl-run-two", actorId: null,
  });

  const timeline = (scope: string, id: string | null, bucket = "week") =>
    client.query("select * from public.page_timeline($1, $2, $3, $4, null, null)",
      [scope, id, PAGE_ID, bucket]);

  const runs = (scope: string, id: string | null) =>
    client.query("select * from public.page_run_history($1, $2, $3)", [scope, id, PAGE_ID]);

  const evidence = (
    scope: string, id: string | null, metric: string,
    from: string | null, to: string | null, runId: string | null, status: string | null,
  ) => client.query(
    `select * from public.page_timeline_evidence(${EVIDENCE_ARGS})`,
    [scope, id, PAGE_ID, metric, from, to, runId, status, 100, 0],
  );

  await t.test("the run history is history, not the newest observation repeated", async () => {
    const { rows } = await runs("category", category);
    assert.equal(rows.length, 2);

    // Newest first.
    const [two, one] = rows;
    assert.equal(new Date(one.collected_at).toISOString(), RUN_ONE);
    assert.equal(new Date(two.collected_at).toISOString(), RUN_TWO);

    // Run one saw three ads, all active — even though every one of them looks
    // different now. This is the assertion that fails if the timeline is ever
    // rebuilt on the latest-per-ad reduction.
    assert.equal(Number(one.observed_ads), 3);
    assert.equal(Number(one.active_ads), 3);
    assert.equal(Number(one.inactive_ads), 0);
    assert.equal(Number(one.unknown_ads), 0);

    // Run two saw four: one stopped, one unreadable, two active.
    assert.equal(Number(two.observed_ads), 4);
    assert.equal(Number(two.active_ads), 2);
    assert.equal(Number(two.inactive_ads), 1);
    assert.equal(Number(two.unknown_ads), 1);
  });

  await t.test("unknown is never counted as inactive at any point in time", async () => {
    const { rows } = await runs("category", category);
    for (const run of rows) {
      assert.equal(
        Number(run.observed_ads),
        Number(run.active_ads) + Number(run.inactive_ads) + Number(run.unknown_ads),
        "the three states must partition the observed ads exactly",
      );
    }
  });

  await t.test("newly encountered is scope-local and counts each ad once", async () => {
    const { rows } = await runs("category", category);
    const [two, one] = rows;
    // All three of run one's ads were new to this scope then; only the fourth
    // was new in run two. An ad seen in both runs is not "new" twice.
    assert.equal(Number(one.newly_encountered), 3);
    assert.equal(Number(two.newly_encountered), 1);
  });

  await t.test("run identity travels with the row, so comparability can be judged", async () => {
    const { rows } = await runs("category", category);
    const queries = rows.map((row) => row.scope_query);
    assert.deepEqual([...new Set(queries)].sort(), ["คอลลาเจน", "วิตามิน"]);
    assert.ok(rows.every((row) => row.dataset_name.startsWith("tl-run-")));
  });

  await t.test("a dataset scope holds exactly one run, and says so honestly", async () => {
    const { rows } = await runs("dataset", runOne.datasetId);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].observed_ads), 3);
    // The ad-property series still span years, because those are properties of
    // the ads this dataset contains — not of the run that collected them.
    const points = await timeline("dataset", runOne.datasetId);
    const started = points.rows.reduce((sum, row) => sum + Number(row.started_ads), 0);
    assert.equal(started, 3);
    assert.ok(points.rows.length > 1, "three ads started in three different years");
  });

  await t.test("started and first-seen are different buckets of different clocks", async () => {
    const { rows } = await timeline("category", category);
    const started = rows.reduce((sum, row) => sum + Number(row.started_ads), 0);
    const firstSeen = rows.reduce((sum, row) => sum + Number(row.first_seen_ads), 0);
    // Four distinct ads, counted once in each series.
    assert.equal(started, 4);
    assert.equal(firstSeen, 4);

    // ...but not in the same places. The ads started between 2020 and 2026 and
    // were first seen in the last three weeks, so each series has buckets the
    // other is empty in. A single merged "activity" series could not.
    const startedOnly = rows.filter((row) => Number(row.started_ads) > 0 && Number(row.first_seen_ads) === 0);
    const seenOnly = rows.filter((row) => Number(row.first_seen_ads) > 0 && Number(row.started_ads) === 0);
    assert.ok(startedOnly.length >= 3, "old starts nobody had seen yet");
    assert.ok(seenOnly.length >= 1, "a sighting of an ad that started long before");

    // The spans themselves are years apart, which is the fact the separation
    // protects: an ad running since 2020 that we met last week.
    const oldest = new Date(rows[0].bucket_start).getTime();
    const newest = new Date(rows[rows.length - 1].bucket_start).getTime();
    assert.ok(newest - oldest > 365 * DAY, "the two clocks span years, not days");
  });

  await t.test("an ad in two runs is one ad in a per-ad series", async () => {
    // Ads A, B and C were observed twice. If the series counted observations
    // instead of ads, this would be seven.
    const { rows } = await timeline("category", category, "day");
    assert.equal(rows.reduce((sum, row) => sum + Number(row.first_seen_ads), 0), 4);
  });

  /* ----------------------------------------------------- reconciliation */

  await t.test("every started bucket reconciles exactly with its evidence", async () => {
    const { rows } = await timeline("category", category, "day");
    for (const row of rows.filter((entry) => Number(entry.started_ads) > 0)) {
      const from = new Date(row.bucket_start).toISOString();
      const to = new Date(new Date(row.bucket_start).getTime() + DAY).toISOString();
      const ads = await evidence("category", category, "started", from, to, null, null);
      assert.equal(
        ads.rows.length,
        Number(row.started_ads),
        `started bucket ${from} claimed ${row.started_ads} and returned ${ads.rows.length}`,
      );
    }
  });

  await t.test("every first-seen bucket reconciles exactly with its evidence", async () => {
    const { rows } = await timeline("category", category, "day");
    for (const row of rows.filter((entry) => Number(entry.first_seen_ads) > 0)) {
      const from = new Date(row.bucket_start).toISOString();
      const to = new Date(new Date(row.bucket_start).getTime() + DAY).toISOString();
      const ads = await evidence("category", category, "first_seen", from, to, null, null);
      assert.equal(ads.rows.length, Number(row.first_seen_ads));
    }
  });

  await t.test("every run count reconciles exactly with its evidence, state by state", async () => {
    const { rows } = await runs("category", category);
    for (const run of rows) {
      const all = await evidence("category", category, "run", null, null, run.collection_run_id, null);
      assert.equal(all.rows.length, Number(run.observed_ads));

      for (const [status, expected] of [
        ["active", run.active_ads], ["inactive", run.inactive_ads], ["unknown", run.unknown_ads],
      ] as const) {
        const filtered = await evidence(
          "category", category, "run", null, null, run.collection_run_id, status,
        );
        assert.equal(
          filtered.rows.length,
          Number(expected),
          `${status} in run ${run.dataset_name} claimed ${expected} and returned ${filtered.rows.length}`,
        );
      }
    }
  });

  await t.test("run evidence shows the state that run saw, not the newest one", async () => {
    const { rows } = await runs("category", category);
    const [, one] = rows;
    const ads = await evidence("category", category, "run", null, null, one.collection_run_id, null);
    // Ad A is inactive now. In run one it was active, and that is what its
    // evidence row must say.
    const adA = ads.rows.find((row) => row.ad_archive_id === AD_A.id);
    assert.equal(adA.is_active, true, "the run's own observation, not the latest");
  });

  await t.test("the mix of one run is that run's mix, with that run's coverage", async () => {
    const { rows } = await runs("category", category);
    const [two, one] = rows;

    const mixOne = await client.query(
      "select * from public.page_run_mix($1, $2, $3, $4)",
      ["category", category, PAGE_ID, one.collection_run_id],
    );
    const ctaOne = mixOne.rows.filter((row) => row.dimension === "cta_type");
    // Two of three ads had a readable CTA in run one.
    assert.equal(Number(ctaOne[0].covered), 2);
    assert.equal(Number(ctaOne[0].observed), 3);

    const mixTwo = await client.query(
      "select * from public.page_run_mix($1, $2, $3, $4)",
      ["category", category, PAGE_ID, two.collection_run_id],
    );
    const ctaTwo = mixTwo.rows.filter((row) => row.dimension === "cta_type");
    // ...and two of four in run two. One coverage badge cannot describe both.
    assert.equal(Number(ctaTwo[0].covered), 2);
    assert.equal(Number(ctaTwo[0].observed), 4);
  });

  await t.test("a range window excludes nothing it was not asked to", async () => {
    const recent = await client.query(
      "select * from public.page_timeline($1, $2, $3, $4, $5, $6)",
      ["category", category, PAGE_ID, "day",
       new Date(Date.now() - 30 * DAY).toISOString(), new Date(Date.now() + DAY).toISOString()],
    );
    // Only ad D started in the last 30 days; the other three are older and are
    // correctly outside the window rather than silently folded into its edge.
    assert.equal(recent.rows.reduce((sum, row) => sum + Number(row.started_ads), 0), 1);
    // Every ad was first seen inside the window, because that is when we ran.
    assert.equal(recent.rows.reduce((sum, row) => sum + Number(row.first_seen_ads), 0), 4);
  });

  await t.test("a page outside the scope has no timeline at all", async () => {
    const other = await seedCategory(client, "pt-timeline-other");
    assert.equal((await runs("category", other)).rows.length, 0);
    assert.equal((await timeline("category", other)).rows.length, 0);
    const ads = await evidence("category", other, "run", null, null, runTwo.collectionRunId, null);
    assert.equal(ads.rows.length, 0, "a run outside the scope must not answer");
  });

  await t.test("every timeline function is invoker-rights and denied to anon", async () => {
    const names = [
      "page_scope_ads", "page_timeline", "page_run_history",
      "page_run_mix", "page_timeline_evidence",
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
