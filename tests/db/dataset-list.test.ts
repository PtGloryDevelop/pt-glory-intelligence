import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import { GOLDEN_EXPECTED } from "../fixtures/load.ts";
import { connect, goldenCanonical, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * dataset_list() is a projection over data the import already wrote. These
 * cases pin the two things a projection can quietly get wrong: counting
 * something other than what the column claims, and reporting a dataset as
 * clean when its quality was never measured.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("dataset list projection", { skip }, async (t) => {
  const client = await connect();
  t.after(async () => {
    await resetTables(client);
    await client.end();
    await closePool();
  });

  await t.test("counts come from membership, and the tier is the worst field", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const { datasetId } = await commitImport({
      canonical: goldenCanonical(), categoryId, datasetName: "list-golden", actorId: null,
    });

    const { rows } = await client.query("select * from public.dataset_list()");
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.dataset_id, datasetId);
    assert.equal(row.dataset_name, "list-golden");
    assert.equal(Number(row.ads_in_dataset), GOLDEN_EXPECTED.uniqueAds);
    assert.equal(Number(row.pages_in_dataset), GOLDEN_EXPECTED.uniquePages);
    assert.equal(row.run_status, "completed");
    assert.equal(row.collection_method, "network_response_observation");

    // The golden export has fields the collector cannot always read, so the
    // dataset's worst tier must not come back as 'normal'.
    const { rows: tiers } = await client.query<{ tier: string }>(
      "select distinct tier from public.dataset_quality where dataset_id = $1", [datasetId],
    );
    const present = new Set(tiers.map((t) => t.tier));
    const worst = present.has("low") ? "low" : present.has("partial") ? "partial" : "normal";
    assert.equal(row.quality_tier, worst, "list tier is the worst field tier");
  });

  await t.test("a dataset with no quality rows reads unknown, not normal", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const { datasetId } = await commitImport({
      canonical: singleAdCanonical({ collectedAt: "2026-08-10T00:00:00.000Z" }),
      categoryId, datasetName: "list-unmeasured", actorId: null,
    });
    await client.query("delete from public.dataset_quality where dataset_id = $1", [datasetId]);

    const { rows } = await client.query(
      "select quality_tier from public.dataset_list() where dataset_id = $1", [datasetId],
    );
    assert.equal(rows[0].quality_tier, "unknown");
  });

  await t.test("newest dataset first, and each row keeps its own counts", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    await commitImport({
      canonical: singleAdCanonical({ collectedAt: "2026-08-10T00:00:00.000Z" }),
      categoryId, datasetName: "older", actorId: null,
    });
    await commitImport({
      canonical: goldenCanonical({ collectedAt: "2026-08-28T00:00:00.000Z" }),
      categoryId, datasetName: "newer", actorId: null,
    });

    const { rows } = await client.query("select * from public.dataset_list()");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].dataset_name, "newer", "ordered by created_at desc");
    assert.equal(Number(rows[0].ads_in_dataset), GOLDEN_EXPECTED.uniqueAds);
    assert.equal(Number(rows[1].ads_in_dataset), 1, "the old dataset keeps its own snapshot size");
    assert.equal(Number(rows[1].pages_in_dataset), 1);
  });
});
