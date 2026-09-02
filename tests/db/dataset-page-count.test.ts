import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import { connect, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * Two different page counts, on purpose.
 *
 *   pages_in_dataset      — pages reachable from this dataset's ads
 *   computed_unique_pages — pages the collector saw in the whole run
 *
 * On a partial run they differ, because a quarantined row can carry a page that
 * never becomes dataset membership. The failure this guards against is either
 * number being quietly served in place of the other.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

/** One importable ad plus one quarantined row whose page is only in the run. */
function partialCanonical() {
  const canonical = singleAdCanonical({ collectedAt: "2026-08-20T00:00:00.000Z" });
  canonical.quarantine = [{
    reason: "missing_ad_archive_id",
    payload: { page_id: "999888777666", start_date: "2026-01-01T00:00:00.000Z" },
  }];
  // The collector saw two source rows across two pages; only one resolves.
  canonical.run.reported = { sourceRows: 2, uniqueAds: 1, uniquePages: 2, unresolvedCount: 1, qualitySummary: null };
  canonical.run.computed = { sourceRows: 2, uniqueAds: 1, uniquePages: 2, unresolvedCount: 1 };
  return canonical;
}

test("dataset page count vs run page count", { skip }, async (t) => {
  const client = await connect();
  t.after(async () => {
    await resetTables(client);
    await client.end();
    await closePool();
  });

  await t.test("a partial run keeps both counts, and neither replaces the other", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const { datasetId, status } = await commitImport({
      canonical: partialCanonical(), categoryId, datasetName: "partial-pages", actorId: null,
    });
    assert.equal(status, "partial", "the fixture must actually produce a partial run");

    const { rows } = await client.query("select * from public.dataset_context($1)", [datasetId]);
    assert.equal(rows.length, 1);
    const context = rows[0];

    assert.equal(Number(context.pages_in_dataset), 1, "dataset membership: one ad, one page");
    assert.equal(context.computed_unique_pages, 2, "run provenance keeps the collector's count");
    assert.notEqual(
      Number(context.pages_in_dataset), context.computed_unique_pages,
      "this fixture is only meaningful while the two counts differ",
    );
    assert.equal(Number(context.quarantine_count), 1);
    assert.equal(Number(context.ads_in_dataset), 1);

    // The list column and the detail KPI must be the same number.
    const list = await client.query(
      "select pages_in_dataset from public.dataset_list() where dataset_id = $1", [datasetId],
    );
    assert.equal(
      Number(list.rows[0].pages_in_dataset), Number(context.pages_in_dataset),
      "dataset list and dataset detail must agree on Pages",
    );
  });

  await t.test("a clean run has nothing to disagree about", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const { datasetId, status } = await commitImport({
      canonical: singleAdCanonical({ collectedAt: "2026-08-21T00:00:00.000Z" }),
      categoryId, datasetName: "clean-pages", actorId: null,
    });
    assert.equal(status, "completed");

    const { rows } = await client.query("select * from public.dataset_context($1)", [datasetId]);
    assert.equal(Number(rows[0].pages_in_dataset), 1);
    assert.equal(rows[0].computed_unique_pages, 1);
  });
});
