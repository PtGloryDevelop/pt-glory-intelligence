import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import type { CanonicalImport } from "../../lib/domain/types.ts";
import { connect, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * The page compare read layer (migration 0029).
 *
 * Compare defines nothing, so most of these cases prove exactly that: each
 * compared number equals the number the page's own function produces, and each
 * one opens the ads the frozen evidence readers return. If those two ever drift
 * apart, Compare has grown a second definition and these tests fail.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const ADS_ARGS = "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11";
const EVIDENCE_ARGS = "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10";

const DAY = 86_400_000;
const RUN_ONE = new Date(Date.now() - 20 * DAY).toISOString();
const RUN_TWO = new Date(Date.now() - 2 * DAY).toISOString();

const PAGE_A = "950000000000001";
const PAGE_B = "950000000000002";
const PAGE_ELSEWHERE = "950000000000003";

type AdSpec = {
  id: string; pageId: string; startDate: string;
  isActive: boolean | null; format: string | null; cta: string | null;
  collation?: number; platforms?: string[];
};

function runCanonical(options: { collectedAt: string; ads: AdSpec[] }): CanonicalImport {
  const first = options.ads[0];
  const canonical = singleAdCanonical({
    collectedAt: options.collectedAt, pageId: first.pageId, adArchiveId: first.id,
  });
  const [ad] = canonical.ads;
  const [observation] = canonical.adObservations;
  const [pageObservation] = canonical.pageObservations;

  const pageIds = [...new Set(options.ads.map((entry) => entry.pageId))];
  canonical.pages = pageIds.map((pageId) => ({
    pageId, pageProfileNumericId: null, pageProfileUri: null,
  }));
  canonical.pageObservations = pageIds.map((pageId) => ({
    ...pageObservation, pageId, pageName: `เพจ ${pageId.slice(-1)}`,
    pageCategories: ["Health/beauty"],
  }));

  canonical.ads = [];
  canonical.adObservations = [];
  for (const entry of options.ads) {
    canonical.ads.push({
      ...ad, adArchiveId: entry.id, pageId: entry.pageId, startDate: entry.startDate,
      isActive: entry.isActive, displayFormat: entry.format,
      publisherPlatform: entry.platforms ?? ["FACEBOOK"],
    });
    canonical.adObservations.push({
      ...observation, adArchiveId: entry.id, isActive: entry.isActive,
      displayFormat: entry.format, publisherPlatform: entry.platforms ?? ["FACEBOOK"],
      ctaType: entry.cta, collationCount: entry.collation ?? 1,
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

/*
 * A is the busier page with an old evergreen ad and a reused one; B is smaller,
 * newer, and — crucially — has far worse CTA coverage, which is what makes the
 * asymmetric-coverage case real rather than hypothetical.
 */
const A_ADS: AdSpec[] = [
  { id: "950000000000101", pageId: PAGE_A, startDate: "2020-02-01T00:00:00.000Z",
    isActive: true, format: "VIDEO", cta: "MESSAGE_PAGE", collation: 6,
    platforms: ["FACEBOOK", "INSTAGRAM"] },
  { id: "950000000000102", pageId: PAGE_A, startDate: "2021-06-01T00:00:00.000Z",
    isActive: true, format: "IMAGE", cta: "LEARN_MORE", collation: 3 },
  { id: "950000000000103", pageId: PAGE_A, startDate: new Date(Date.now() - 5 * DAY).toISOString(),
    isActive: true, format: "IMAGE", cta: "MESSAGE_PAGE" },
];

const B_ADS: AdSpec[] = [
  { id: "950000000000201", pageId: PAGE_B, startDate: "2022-01-01T00:00:00.000Z",
    isActive: false, format: "VIDEO", cta: null },
  { id: "950000000000202", pageId: PAGE_B, startDate: new Date(Date.now() - 3 * DAY).toISOString(),
    isActive: true, format: "IMAGE", cta: null, platforms: ["INSTAGRAM"] },
  { id: "950000000000203", pageId: PAGE_B, startDate: "2019-01-01T00:00:00.000Z",
    isActive: null, format: null, cta: "LEARN_MORE" },
];

test("page compare read layer", { skip, concurrency: 1 }, async (t) => {
  const client = await connect();
  await resetTables(client);

  const category = await seedCategory(client, "pc-main");
  const otherCategory = await seedCategory(client, "pc-other");

  const runOne = await commitImport({
    canonical: runCanonical({
      collectedAt: RUN_ONE,
      // Everything active in the first run, so a later change is observable.
      ads: [...A_ADS, ...B_ADS].map((entry) => ({ ...entry, isActive: true })),
    }),
    categoryId: category, datasetName: "pc-run-one", actorId: null,
  });

  const runTwo = await commitImport({
    canonical: runCanonical({ collectedAt: RUN_TWO, ads: [...A_ADS, ...B_ADS] }),
    categoryId: category, datasetName: "pc-run-two", actorId: null,
  });

  await commitImport({
    canonical: runCanonical({
      collectedAt: RUN_ONE,
      ads: [{
        id: "950000000000301", pageId: PAGE_ELSEWHERE, startDate: "2023-01-01T00:00:00.000Z",
        isActive: true, format: "IMAGE", cta: null,
      }],
    }),
    categoryId: otherCategory, datasetName: "pc-other-run", actorId: null,
  });

  const summary = (scope: string, id: string | null, a: string, b: string, days = 30) =>
    client.query(
      "select * from public.page_compare_summary($1, $2, $3, $4, $5)", [scope, id, a, b, days],
    );

  const detail = (scope: string, id: string | null, pageId: string, days = 30) =>
    client.query("select * from public.page_detail($1, $2, $3, $4)", [scope, id, pageId, days]);

  const pageAds = (scope: string, id: string | null, pageId: string, args: {
    signal?: string | null; format?: string | null; cta?: string | null; platform?: string | null;
  } = {}) => client.query(
    `select * from public.page_ads(${ADS_ARGS})`,
    [scope, id, pageId, args.signal ?? null, 30, args.format ?? null, args.cta ?? null,
     args.platform ?? null, "started_desc", 200, 0],
  );

  await t.test("compare returns exactly the numbers page_detail returns", async () => {
    const both = await summary("category", category, PAGE_A, PAGE_B);
    const a = both.rows.find((row) => row.side === "a")!;
    const b = both.rows.find((row) => row.side === "b")!;
    const directA = (await detail("category", category, PAGE_A)).rows[0];
    const directB = (await detail("category", category, PAGE_B)).rows[0];

    // Column by column: Compare is a projection, not a recalculation.
    for (const column of [
      "observed_ads", "active_ads", "inactive_ads", "unknown_ads", "recently_found",
      "started_recently", "evergreen_ads", "reused_ads", "max_collation",
    ]) {
      assert.equal(String(a[column]), String(directA[column]), `A.${column}`);
      assert.equal(String(b[column]), String(directB[column]), `B.${column}`);
    }
  });

  await t.test("both sides always get the same scope and the same period", async () => {
    const seven = await summary("category", category, PAGE_A, PAGE_B, 7);
    const thirty = await summary("category", category, PAGE_A, PAGE_B, 30);
    // The window is passed once and used twice: changing it moves both sides or
    // neither, never one.
    const startedSeven = seven.rows.map((row) => Number(row.started_recently));
    const startedThirty = thirty.rows.map((row) => Number(row.started_recently));
    assert.deepEqual(startedSeven, [1, 1]);
    assert.deepEqual(startedThirty, [1, 1]);
  });

  await t.test("a page outside the scope is not in scope, not zero", async () => {
    const both = await summary("category", category, PAGE_A, PAGE_ELSEWHERE);
    const a = both.rows.find((row) => row.side === "a")!;
    const b = both.rows.find((row) => row.side === "b")!;
    assert.equal(a.in_scope, true);
    // The page exists in the product, but not here — and the flag says so even
    // though every count beside it is zero.
    assert.equal(b.in_scope, false);
    assert.equal(Number(b.observed_ads), 0);

    // ...and page_in_scope is the single source of that answer.
    const inScope = await client.query(
      "select public.page_in_scope($1, $2, $3) as ok", ["category", category, PAGE_ELSEWHERE],
    );
    assert.equal(inScope.rows[0].ok, false);
    assert.equal(
      (await client.query("select public.page_in_scope($1, $2, $3) as ok",
        ["category", otherCategory, PAGE_ELSEWHERE])).rows[0].ok,
      true,
    );
  });

  await t.test("dataset scope compares that dataset's own observations", async () => {
    // Run one saw every ad active. Run two saw one of B's stopped and one
    // unreadable. Comparing inside dataset one must still report run one.
    const first = await summary("dataset", runOne.datasetId, PAGE_A, PAGE_B);
    const second = await summary("dataset", runTwo.datasetId, PAGE_A, PAGE_B);

    const bFirst = first.rows.find((row) => row.side === "b")!;
    const bSecond = second.rows.find((row) => row.side === "b")!;
    assert.equal(Number(bFirst.active_ads), 3, "run one saw all three of B active");
    assert.equal(Number(bSecond.active_ads), 1);
    assert.equal(Number(bSecond.inactive_ads), 1);
    assert.equal(Number(bSecond.unknown_ads), 1, "unknown stays its own state");
  });

  await t.test("a later import does not rewrite an older dataset's comparison", async () => {
    // The whole point of snapshot truth, restated at compare level: dataset one
    // was collected before run two existed, and still answers as it did.
    const first = await summary("dataset", runOne.datasetId, PAGE_A, PAGE_B);
    for (const row of first.rows) {
      assert.equal(Number(row.unknown_ads), 0, "run one could read every state");
    }
  });

  await t.test("each side keeps its own coverage denominator", async () => {
    const { rows } = await client.query(
      "select * from public.page_compare_mix($1, $2, $3, $4)", ["category", category, PAGE_A, PAGE_B],
    );
    const cta = (side: string) => rows.filter((row) => row.side === side && row.dimension === "cta_type");

    // A: all three ads have a readable CTA. B: one of three.
    assert.equal(Number(cta("a")[0].covered), 3);
    assert.equal(Number(cta("a")[0].observed), 3);
    assert.equal(Number(cta("b")[0].covered), 1);
    assert.equal(Number(cta("b")[0].observed), 3);
    // Asymmetric on purpose — one shared coverage number would describe neither.
    assert.notEqual(Number(cta("a")[0].covered), Number(cta("b")[0].covered));
  });

  await t.test("the mix is exactly what each page's own mix says", async () => {
    const compare = await client.query(
      "select * from public.page_compare_mix($1, $2, $3, $4)", ["category", category, PAGE_A, PAGE_B],
    );
    for (const [side, pageId] of [["a", PAGE_A], ["b", PAGE_B]] as const) {
      const direct = await client.query(
        "select * from public.page_creative_mix($1, $2, $3)", ["category", category, pageId],
      );
      const mine = compare.rows
        .filter((row) => row.side === side)
        .map((row) => `${row.dimension}:${row.value}:${row.n}:${row.covered}`)
        .sort();
      const theirs = direct.rows
        .map((row) => `${row.dimension}:${row.value}:${row.n}:${row.covered}`)
        .sort();
      assert.deepEqual(mine, theirs, `${side} mix must equal page_creative_mix`);
    }
  });

  await t.test("one clock, one set of buckets, both sides", async () => {
    for (const metric of ["started", "first_seen"] as const) {
      const { rows } = await client.query(
        "select * from public.page_compare_timeline($1, $2, $3, $4, $5, $6, null, null)",
        ["category", category, PAGE_A, PAGE_B, metric, "week"],
      );
      const a = await client.query(
        "select * from public.page_timeline($1, $2, $3, $4, null, null)",
        ["category", category, PAGE_A, "week"],
      );
      const column = metric === "started" ? "started_ads" : "first_seen_ads";
      const fromCompare = rows.reduce((sum, row) => sum + Number(row.a_ads), 0);
      const fromPage = a.rows.reduce((sum, row) => sum + Number(row[column]), 0);
      assert.equal(fromCompare, fromPage, `${metric}: A's series must match page_timeline`);

      // Every bucket carries both sides, so a bucket where only one page has
      // ads still shows the other's zero rather than disappearing.
      assert.ok(rows.every((row) => row.a_ads !== null && row.b_ads !== null));
    }
  });

  await t.test("a bucket where only one side has ads keeps the other's zero", async () => {
    const { rows } = await client.query(
      "select * from public.page_compare_timeline($1, $2, $3, $4, $5, $6, null, null)",
      ["category", category, PAGE_A, PAGE_B, "started", "week"],
    );
    assert.ok(
      rows.some((row) => Number(row.a_ads) > 0 && Number(row.b_ads) === 0),
      "A started ads in a week B did not",
    );
    assert.ok(rows.some((row) => Number(row.b_ads) > 0 && Number(row.a_ads) === 0));
  });

  /* ----------------------------------------------------- reconciliation */

  await t.test("every summary number opens exactly its ads, on both sides", async () => {
    const both = await summary("category", category, PAGE_A, PAGE_B);
    for (const row of both.rows) {
      const pageId = row.page_id;
      const cases: [string | null, number][] = [
        [null, Number(row.observed_ads)],
        ["recent", Number(row.recently_found)],
        ["started_recently", Number(row.started_recently)],
        ["evergreen", Number(row.evergreen_ads)],
        ["reused", Number(row.reused_ads)],
        ["active", Number(row.active_ads)],
        ["inactive", Number(row.inactive_ads)],
        ["unknown", Number(row.unknown_ads)],
      ];
      for (const [signal, expected] of cases) {
        const ads = await pageAds("category", category, pageId, { signal });
        assert.equal(
          ads.rows.length, expected,
          `${row.side}.${signal ?? "observed"} claimed ${expected}, returned ${ads.rows.length}`,
        );
      }
    }
  });

  await t.test("every mix bucket opens exactly its ads, on the right side", async () => {
    const { rows } = await client.query(
      "select * from public.page_compare_mix($1, $2, $3, $4)", ["category", category, PAGE_A, PAGE_B],
    );
    for (const row of rows) {
      if (row.value === "—") continue; // unreadable is not a filterable value
      const key =
        row.dimension === "display_format" ? { format: row.value }
        : row.dimension === "cta_type" ? { cta: row.value }
        : row.dimension === "publisher_platform" ? { platform: row.value }
        : null;
      if (!key) continue; // Meta's page categories are page metadata
      const pageId = row.side === "a" ? PAGE_A : PAGE_B;
      const ads = await pageAds("category", category, pageId, key);
      assert.equal(
        ads.rows.length, Number(row.n),
        `${row.side} ${row.dimension}=${row.value} claimed ${row.n}`,
      );
    }
  });

  await t.test("every timeline bucket opens exactly its ads, on both sides", async () => {
    const { rows } = await client.query(
      "select * from public.page_compare_timeline($1, $2, $3, $4, $5, $6, null, null)",
      ["category", category, PAGE_A, PAGE_B, "started", "day"],
    );
    for (const row of rows) {
      const from = new Date(row.bucket_start).toISOString();
      const to = new Date(new Date(row.bucket_start).getTime() + DAY).toISOString();
      for (const [side, pageId, expected] of [
        ["a", PAGE_A, Number(row.a_ads)], ["b", PAGE_B, Number(row.b_ads)],
      ] as const) {
        if (expected === 0) continue;
        const ads = await client.query(
          `select * from public.page_timeline_evidence(${EVIDENCE_ARGS})`,
          ["category", category, pageId, "started", from, to, null, null, 200, 0],
        );
        assert.equal(ads.rows.length, expected, `${side} bucket ${from}`);
      }
    }
  });

  await t.test("compare functions are invoker-rights and denied to anon", async () => {
    const names = [
      "page_in_scope", "page_compare_summary", "page_compare_mix", "page_compare_timeline",
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
