import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import type { CanonicalImport } from "../../lib/domain/types.ts";
import { connect, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * The two guards the P2.6 foundation audit left behind.
 *
 * Each migration asserts the security of its own functions, which is exactly
 * the arrangement that lets one slip through — 0017's helper kept PostgreSQL's
 * default EXECUTE to PUBLIC for four migrations because nothing looked at the
 * whole schema at once. The first case here does.
 *
 * The second guards the foundation's main piece of architecture debt. "The
 * latest observation of each ad in scope" is written three times — in
 * page_detail, in category_detail and in trend_summary's reconstruction — and
 * today all three agree. Nothing but this test would notice if one drifted.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

/** Deliberately unreachable from app roles: the two machine schedulers. */
const MACHINE_ONLY = new Set(["run_media_archive_drain", "run_collection_advance"]);
/** Deliberately SECURITY DEFINER, each for a documented reason. */
const DEFINER_ALLOWED = new Set([
  "current_user_role", "evergreen_threshold_days", "run_media_archive_drain",
  "run_collection_advance",
]);

test("every function this product defines keeps the read-layer security contract", { skip }, async () => {
  const client = await connect();
  try {
    const { rows } = await client.query(`
      select p.proname,
             p.prosecdef                                               as definer,
             has_function_privilege('anon', p.oid, 'execute')          as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
             (p.proconfig is not null and exists (
                select 1 from unnest(p.proconfig) c where c like 'search_path=%')) as pinned,
             (select count(*) from aclexplode(p.proacl) a where a.grantee = 0)::int as public_grants
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prokind = 'f'
         -- Extension-owned functions are not ours to re-permission: pg_trgm
         -- installs its operators in public with EXECUTE to PUBLIC by design.
         and not exists (
           select 1 from pg_depend d
            where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e')
       order by p.proname`);

    assert.ok(rows.length > 30, "the sweep should see the whole read layer");

    for (const row of rows) {
      assert.equal(row.anon, false, `${row.proname} must not be executable by anon`);
      assert.equal(row.public_grants, 0, `${row.proname} must not be granted to PUBLIC`);
      assert.equal(row.pinned, true, `${row.proname} must pin its search_path`);

      if (!MACHINE_ONLY.has(row.proname)) {
        assert.equal(
          row.authenticated, true,
          `${row.proname} must stay executable by authenticated`,
        );
      }
      if (row.definer) {
        assert.ok(
          DEFINER_ALLOWED.has(row.proname),
          `${row.proname} is SECURITY DEFINER without being on the documented list`,
        );
      }
    }
  } finally {
    await client.end();
  }
});

/** One page, four ads, spanning the states every current-view metric counts. */
function auditCanonical(collectedAt: string): CanonicalImport {
  const canonical = singleAdCanonical({
    collectedAt, pageId: "970000000000001", adArchiveId: "970000000000101",
  });
  const [ad] = canonical.ads;
  const [observation] = canonical.adObservations;

  const variants = [
    { id: "970000000000101", start: "2020-01-01T00:00:00.000Z", active: true, collation: 4 },
    { id: "970000000000102", start: "2021-06-01T00:00:00.000Z", active: true, collation: 1 },
    { id: "970000000000103", start: "2022-02-01T00:00:00.000Z", active: false, collation: 3 },
    { id: "970000000000104", start: "2019-09-01T00:00:00.000Z", active: null, collation: 1 },
  ];

  canonical.ads = [];
  canonical.adObservations = [];
  for (const variant of variants) {
    canonical.ads.push({
      ...ad, adArchiveId: variant.id, startDate: variant.start, isActive: variant.active,
      displayFormat: "IMAGE", publisherPlatform: ["FACEBOOK"],
    });
    canonical.adObservations.push({
      ...observation, adArchiveId: variant.id, isActive: variant.active,
      displayFormat: "IMAGE", publisherPlatform: ["FACEBOOK"],
      collationCount: variant.collation,
      provenance: { ...observation.provenance, recordKey: `ad:${variant.id}` },
    });
  }

  canonical.run.reported = {
    ...canonical.run.reported, sourceRows: 4, uniqueAds: 4, uniquePages: 1,
  };
  canonical.run.computed = { sourceRows: 4, uniqueAds: 4, uniquePages: 1, unresolvedCount: 0 };
  return canonical;
}

test("the three current-view implementations agree", { skip }, async () => {
  const client = await connect();
  try {
    await resetTables(client);
    const category = await seedCategory(client, "audit-agreement");
    await commitImport({
      canonical: auditCanonical(new Date(Date.now() - 2 * 86_400_000).toISOString()),
      categoryId: category, datasetName: "audit-agreement", actorId: null,
    });

    const categoryRow = (await client.query(
      "select * from public.category_detail($1, 30)", [category],
    )).rows[0];

    const pageRow = (await client.query(
      "select * from public.page_detail($1, $2, $3, 30)",
      ["category", category, "970000000000001"],
    )).rows[0];

    // A reference instant in the future: the reconstruction should then be the
    // current view, which is the only place the two definitions must coincide.
    const soon = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 3650 * 86_400_000).toISOString();
    const trendRows = (await client.query(
      "select * from public.trend_summary($1, $2, null, $3, $4, $5, $5)",
      ["category", category, past, soon, past],
    )).rows;
    const trend = (metric: string) =>
      Number(trendRows.find((row) => row.metric === metric)!.current_value);

    for (const [label, categoryColumn, pageColumn, trendMetric] of [
      ["observed", "observed_ads", "observed_ads", "observed"],
      ["active", "active_ads", "active_ads", "active"],
      ["inactive", "inactive_ads", "inactive_ads", "inactive"],
      ["unknown", "unknown_ads", "unknown_ads", "unknown"],
      ["evergreen", "evergreen_ads", "evergreen_ads", "evergreen"],
      ["reused", "reused_ads", "reused_ads", "reused"],
    ] as const) {
      const fromCategory = Number(categoryRow[categoryColumn]);
      const fromPage = Number(pageRow[pageColumn]);
      const fromTrend = trend(trendMetric);
      assert.equal(fromPage, fromCategory, `${label}: page_detail vs category_detail`);
      assert.equal(
        fromTrend, fromCategory,
        `${label}: trend reconstruction at a future instant vs category_detail`,
      );
    }

    // The fixture has to actually exercise the states, or the agreement above
    // would be three zeroes agreeing with each other.
    assert.equal(Number(categoryRow.observed_ads), 4);
    assert.equal(Number(categoryRow.unknown_ads), 1);
    assert.equal(Number(categoryRow.evergreen_ads), 2);
    assert.equal(Number(categoryRow.reused_ads), 2);
  } finally {
    await client.end();
    await closePool();
  }
});
