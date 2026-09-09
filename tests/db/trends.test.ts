import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import type { CanonicalImport } from "../../lib/domain/types.ts";
import { connect, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * The Trends read layer (migration 0030).
 *
 * The case this file exists for is historical reconstruction. A state metric
 * read from today's data would report both periods identically; read as if it
 * were an event it would count collections. The fixture makes both mistakes
 * visible: one ad is active in the first run and stopped in the second, so a
 * correct implementation must report different states at the two reference
 * points and identical event counts regardless of how often we collected.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const SUMMARY_ARGS = "$1, $2, $3, $4, $5, $6, $7";
const PAGES_ARGS = "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10";
const EVIDENCE_ARGS = "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13";

const DAY = 86_400_000;
const NOW = Date.now();

/*
 * Two runs, both inside the current 30-day window, and a third far enough back
 * to sit in the previous one. That is what gives the two reference points
 * different answers.
 */
const RUN_OLD = new Date(NOW - 45 * DAY).toISOString();   // previous window
const RUN_MID = new Date(NOW - 20 * DAY).toISOString();   // current window
const RUN_NEW = new Date(NOW - 2 * DAY).toISOString();    // current window

const CURRENT = { from: new Date(NOW - 30 * DAY).toISOString(), to: new Date(NOW).toISOString() };
const PREVIOUS = {
  from: new Date(NOW - 60 * DAY).toISOString(), to: new Date(NOW - 30 * DAY).toISOString(),
};

const PAGE_A = "960000000000001";
const PAGE_B = "960000000000002";

type AdSpec = {
  id: string; pageId: string; startDate: string;
  isActive: boolean | null; format: string | null; cta: string | null; collation?: number;
};

function runCanonical(options: {
  collectedAt: string; ads: AdSpec[]; query?: string;
}): CanonicalImport {
  const first = options.ads[0];
  const canonical = singleAdCanonical({
    collectedAt: options.collectedAt, pageId: first.pageId, adArchiveId: first.id,
  });
  const [ad] = canonical.ads;
  const [observation] = canonical.adObservations;
  const [pageObservation] = canonical.pageObservations;

  canonical.run.scope = { ...canonical.run.scope, query: options.query ?? "วิตามิน", country: "TH" };

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
      isActive: entry.isActive, displayFormat: entry.format, publisherPlatform: ["FACEBOOK"],
    });
    canonical.adObservations.push({
      ...observation, adArchiveId: entry.id, isActive: entry.isActive,
      displayFormat: entry.format, publisherPlatform: ["FACEBOOK"], ctaType: entry.cta,
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

/** Old and long-running: evergreen at both reference points if still active. */
const OLD_AD: AdSpec = {
  id: "960000000000101", pageId: PAGE_A, startDate: "2020-01-01T00:00:00.000Z",
  isActive: true, format: "VIDEO", cta: "MESSAGE_PAGE", collation: 4,
};
/** Started inside the current window, so it is an event there and nowhere else. */
const NEW_AD: AdSpec = {
  id: "960000000000102", pageId: PAGE_A, startDate: new Date(NOW - 6 * DAY).toISOString(),
  isActive: true, format: "IMAGE", cta: null,
};
const B_AD: AdSpec = {
  id: "960000000000201", pageId: PAGE_B, startDate: "2021-05-01T00:00:00.000Z",
  isActive: true, format: "IMAGE", cta: "LEARN_MORE",
};

test("trends read layer", { skip, concurrency: 1 }, async (t) => {
  const client = await connect();
  await resetTables(client);

  const category = await seedCategory(client, "tr-main");
  const otherCategory = await seedCategory(client, "tr-other");

  // Previous window: one run, the old ad active, page B present.
  await commitImport({
    canonical: runCanonical({ collectedAt: RUN_OLD, ads: [OLD_AD, B_AD] }),
    categoryId: category, datasetName: "tr-old", actorId: null,
  });

  // Current window, first run: the same two ads, unchanged.
  await commitImport({
    canonical: runCanonical({ collectedAt: RUN_MID, ads: [OLD_AD, B_AD] }),
    categoryId: category, datasetName: "tr-mid", actorId: null,
  });

  // Current window, second run: the old ad has stopped, a new one appears, and
  // the query changed — so comparability has something real to report.
  await commitImport({
    canonical: runCanonical({
      collectedAt: RUN_NEW, query: "คอลลาเจน",
      ads: [{ ...OLD_AD, isActive: false }, NEW_AD, B_AD],
    }),
    categoryId: category, datasetName: "tr-new", actorId: null,
  });

  await commitImport({
    canonical: runCanonical({
      collectedAt: RUN_MID,
      ads: [{
        id: "960000000000301", pageId: "960000000000003",
        startDate: "2022-01-01T00:00:00.000Z", isActive: true, format: "IMAGE", cta: null,
      }],
    }),
    categoryId: otherCategory, datasetName: "tr-other-run", actorId: null,
  });

  const summary = (scope: string, id: string | null, pageId: string | null = null) =>
    client.query(
      `select * from public.trend_summary(${SUMMARY_ARGS})`,
      [scope, id, pageId, CURRENT.from, CURRENT.to, PREVIOUS.from, PREVIOUS.to],
    );

  const value = (rows: { metric: string; current_value: string; previous_value: string }[], metric: string) => {
    const row = rows.find((entry) => entry.metric === metric)!;
    return { current: Number(row.current_value), previous: Number(row.previous_value) };
  };

  const evidence = (scope: string, id: string | null, args: {
    pageId?: string | null; event?: string | null; from?: string | null; to?: string | null;
    reference?: string | null; signal?: string | null;
    format?: string | null; cta?: string | null; platform?: string | null;
  }) => client.query(
    `select * from public.trend_evidence(${EVIDENCE_ARGS})`,
    [scope, id, args.pageId ?? null, args.event ?? null, args.from ?? null, args.to ?? null,
     args.reference ?? null, args.signal ?? null, args.format ?? null, args.cta ?? null,
     args.platform ?? null, 200, 0],
  );

  await t.test("an event belongs to the window its moment fell in", async () => {
    const rows = (await summary("category", category)).rows;
    const started = value(rows, "started");
    // One ad started inside the current window; the others started years ago
    // and belong to neither.
    assert.equal(started.current, 1);
    assert.equal(started.previous, 0);
  });

  await t.test("an event is not counted once per collection", async () => {
    const rows = (await summary("category", category)).rows;
    const firstSeen = value(rows, "first_seen");
    // Three ads, seen across three runs. If the metric counted observations
    // instead of ads this would be seven.
    assert.equal(firstSeen.current + firstSeen.previous, 3);
  });

  await t.test("a state is reconstructed at each period's end, not from today", async () => {
    const rows = (await summary("category", category)).rows;
    const active = value(rows, "active");
    const inactive = value(rows, "inactive");

    // At the end of the previous window only the old run had happened, and it
    // saw both ads active.
    assert.equal(active.previous, 2);
    assert.equal(inactive.previous, 0);

    // By the end of the current window the newest run had stopped one of them.
    assert.equal(active.current, 2, "the new ad and B are active");
    assert.equal(inactive.current, 1, "the old ad has stopped");
  });

  await t.test("the scope knows nothing it had not yet collected", async () => {
    const rows = (await summary("category", category)).rows;
    const observed = value(rows, "observed");
    // Two ads existed as far as we knew at the previous reference point; three
    // by the current one. The third was not "inactive then" — it was unknown to
    // us entirely.
    assert.equal(observed.previous, 2);
    assert.equal(observed.current, 3);
  });

  await t.test("evergreen uses the age at the reference point, not today's age", async () => {
    const rows = (await summary("category", category)).rows;
    const evergreen = value(rows, "evergreen");
    // Previously: both known ads were active and long past the threshold.
    assert.equal(evergreen.previous, 2);
    // Now: the old one has stopped, so it is no longer evergreen however old it
    // is, and the newest ad is far too young. Only the 2021 ad qualifies.
    assert.equal(evergreen.current, 1);

    const previousAds = await evidence("category", category, {
      reference: PREVIOUS.to, signal: "evergreen",
    });
    assert.deepEqual(
      previousAds.rows.map((row) => row.ad_archive_id).sort(),
      [OLD_AD.id, B_AD.id].sort(),
    );

    const currentAds = await evidence("category", category, {
      reference: CURRENT.to, signal: "evergreen",
    });
    assert.equal(currentAds.rows.length, 1);
    assert.equal(currentAds.rows[0].ad_archive_id, B_AD.id, "a different set, not the same one");
  });

  await t.test("reuse is read from the observation each period actually had", async () => {
    const rows = (await summary("category", category)).rows;
    const reused = value(rows, "reused");
    assert.equal(reused.previous, 1);
    assert.equal(reused.current, 1);
    const ads = await evidence("category", category, {
      reference: PREVIOUS.to, signal: "reused",
    });
    assert.equal(ads.rows.length, 1);
  });

  await t.test("scope membership and event time stay separate", async () => {
    // The other category's ad has a first_seen_at inside the current window,
    // but it is not in this category and must not be counted here.
    const mine = (await summary("category", category)).rows;
    const theirs = (await summary("category", otherCategory)).rows;
    assert.equal(value(mine, "first_seen").current + value(mine, "first_seen").previous, 3);
    assert.equal(value(theirs, "first_seen").current, 1);
  });

  await t.test("a page trend stays inside the page and the scope", async () => {
    const rows = (await summary("category", category, PAGE_A)).rows;
    // Page A has two ads; only one started inside the current window.
    assert.equal(value(rows, "started").current, 1);
    assert.equal(value(rows, "observed").current, 2);
    assert.equal(value(rows, "observed").previous, 1);
  });

  await t.test("page ranking is ordered by arithmetic delta", async () => {
    const increase = await client.query(
      `select * from public.trend_pages(${PAGES_ARGS})`,
      ["category", category, "started", CURRENT.from, CURRENT.to,
       PREVIOUS.from, PREVIOUS.to, "increase", 10, 0],
    );
    assert.equal(increase.rows[0].page_id, PAGE_A);
    assert.equal(Number(increase.rows[0].change), 1);

    const decrease = await client.query(
      `select * from public.trend_pages(${PAGES_ARGS})`,
      ["category", category, "started", CURRENT.from, CURRENT.to,
       PREVIOUS.from, PREVIOUS.to, "decrease", 10, 0],
    );
    // Same set, opposite ordering — a ranking, not a filter.
    assert.equal(
      Number(decrease.rows[0].change) <= Number(increase.rows[0].change), true,
    );
  });

  await t.test("the mix is read at each period's end, with its own coverage", async () => {
    const { rows } = await client.query(
      "select * from public.trend_mix($1, $2, null, $3, $4)",
      ["category", category, CURRENT.to, PREVIOUS.to],
    );
    const cta = (period: string) => rows.filter((row) => row.period === period && row.dimension === "cta_type");

    // Previously two ads, both with a readable CTA. Now three ads, two readable.
    assert.equal(Number(cta("previous")[0].covered), 2);
    assert.equal(Number(cta("previous")[0].observed), 2);
    assert.equal(Number(cta("current")[0].covered), 2);
    assert.equal(Number(cta("current")[0].observed), 3);
  });

  await t.test("contributing runs are listed per period", async () => {
    const current = await client.query(
      "select * from public.trend_context($1, $2, $3, $4)",
      ["category", category, CURRENT.from, CURRENT.to],
    );
    const previous = await client.query(
      "select * from public.trend_context($1, $2, $3, $4)",
      ["category", category, PREVIOUS.from, PREVIOUS.to],
    );
    assert.equal(current.rows.length, 2);
    assert.equal(previous.rows.length, 1);
    // The queries differ, which is what a comparability caveat is built from.
    assert.equal(new Set(current.rows.map((row) => row.scope_query)).size, 2);
  });

  /* ----------------------------------------------------- reconciliation */

  await t.test("every event count opens exactly its ads", async () => {
    const rows = (await summary("category", category)).rows;
    for (const metric of ["first_seen", "started"] as const) {
      const counts = value(rows, metric);
      for (const [period, window, expected] of [
        ["current", CURRENT, counts.current], ["previous", PREVIOUS, counts.previous],
      ] as const) {
        const ads = await evidence("category", category, {
          event: metric, from: window.from, to: window.to,
        });
        assert.equal(
          ads.rows.length, expected,
          `${metric} ${period} claimed ${expected}, returned ${ads.rows.length}`,
        );
      }
    }
  });

  await t.test("every state count opens exactly its ads", async () => {
    const rows = (await summary("category", category)).rows;
    for (const metric of ["observed", "active", "inactive", "unknown", "evergreen", "reused"] as const) {
      const counts = value(rows, metric);
      for (const [period, reference, expected] of [
        ["current", CURRENT.to, counts.current], ["previous", PREVIOUS.to, counts.previous],
      ] as const) {
        const ads = await evidence("category", category, { reference, signal: metric });
        assert.equal(
          ads.rows.length, expected,
          `${metric} ${period} claimed ${expected}, returned ${ads.rows.length}`,
        );
      }
    }
  });

  await t.test("every mix bucket opens exactly its ads, in its own period", async () => {
    const { rows } = await client.query(
      "select * from public.trend_mix($1, $2, null, $3, $4)",
      ["category", category, CURRENT.to, PREVIOUS.to],
    );
    for (const row of rows) {
      if (row.value === "—") continue;
      const key =
        row.dimension === "display_format" ? { format: row.value }
        : row.dimension === "cta_type" ? { cta: row.value }
        : { platform: row.value };
      const reference = row.period === "current" ? CURRENT.to : PREVIOUS.to;
      const ads = await evidence("category", category, { reference, ...key });
      assert.equal(
        ads.rows.length, Number(row.n),
        `${row.period} ${row.dimension}=${row.value} claimed ${row.n}`,
      );
    }
  });

  await t.test("an empty period is empty, and says nothing about activity", async () => {
    // A window before any collection existed: no runs, and no state to read.
    const ancient = {
      from: new Date(NOW - 400 * DAY).toISOString(), to: new Date(NOW - 370 * DAY).toISOString(),
    };
    const context = await client.query(
      "select * from public.trend_context($1, $2, $3, $4)",
      ["category", category, ancient.from, ancient.to],
    );
    assert.equal(context.rows.length, 0, "no runs — the caller must not read this as zero ads");

    const state = await evidence("category", category, {
      reference: ancient.to, signal: "observed",
    });
    assert.equal(state.rows.length, 0);
  });

  await t.test("trend functions are invoker-rights and denied to anon", async () => {
    const names = [
      "trend_state_scope", "trend_summary", "trend_pages", "trend_mix",
      "trend_context", "trend_evidence",
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
