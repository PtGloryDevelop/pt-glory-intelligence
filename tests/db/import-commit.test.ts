import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import { GOLDEN_EXPECTED } from "../fixtures/load.ts";
import { connect, countAll, goldenCanonical, resetTables, seedCategory } from "./helpers.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("T09 — atomic import", { skip }, async (t) => {
  const client = await connect();
  t.after(async () => {
    await resetTables(client);
    await client.end();
    await closePool();
  });

  await t.test("A. the real 500-ad export imports completely", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const result = await commitImport({
      canonical: goldenCanonical(), categoryId, datasetName: "golden", actorId: null,
    });

    assert.equal(result.status, "completed");
    assert.equal(result.quarantined.count, 0);

    const counts = await countAll(client);
    assert.equal(counts.ads, GOLDEN_EXPECTED.uniqueAds, "master ads");
    assert.equal(counts.pages, GOLDEN_EXPECTED.uniquePages, "master pages");
    assert.equal(counts.ad_observations, GOLDEN_EXPECTED.uniqueAds, "ad observations");
    assert.equal(counts.page_observations, GOLDEN_EXPECTED.uniquePages, "page observations");
    assert.equal(counts.dataset_ads, GOLDEN_EXPECTED.uniqueAds, "dataset membership");
    assert.equal(counts.collection_runs, 1);
    assert.equal(counts.datasets, 1);
    assert.equal(counts.import_quarantine, 0);
    assert.equal(counts.audit_logs, 1);

    const quality = await client.query<{ n: string }>(
      "select count(*)::text as n from public.dataset_quality where dataset_id = $1",
      [result.datasetId],
    );
    assert.equal(Number(quality.rows[0].n), 20, "one row per measured field");

    // computed_* is canonical; reported_* is kept only as provenance.
    const run = await client.query(
      `select computed_unique_ads, computed_unique_pages, computed_source_rows,
              reported_unique_ads, status
         from public.collection_runs where id = $1`,
      [result.collectionRunId],
    );
    assert.equal(run.rows[0].computed_unique_ads, 500);
    assert.equal(run.rows[0].computed_unique_pages, 309);
    assert.equal(run.rows[0].computed_source_rows, 500);
    assert.equal(run.rows[0].reported_unique_ads, 500);
    assert.equal(run.rows[0].status, "completed");
  });

  await t.test("B. failure after the ads upsert leaves nothing behind", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const before = await countAll(client);

    await assert.rejects(
      () => commitImport(
        { canonical: goldenCanonical(), categoryId, datasetName: "fail-mid", actorId: null },
        { failAt: "after_ads" },
      ),
      /injected failure after ads upsert/,
    );

    assert.deepEqual(await countAll(client), before, "every table must be unchanged");
  });

  await t.test("C. failure just before COMMIT leaves nothing behind", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const before = await countAll(client);

    await assert.rejects(
      () => commitImport(
        { canonical: goldenCanonical(), categoryId, datasetName: "fail-late", actorId: null },
        { failAt: "before_commit" },
      ),
      /injected failure before commit/,
    );

    assert.deepEqual(await countAll(client), before, "every table must be unchanged");
  });

  await t.test("E. a duplicate ad_archive_id yields one master and one observation", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const canonical = goldenCanonical();
    // Repeat the first ad, as a collector with broken dedup would.
    canonical.ads.push({ ...canonical.ads[0] });
    canonical.adObservations.push({ ...canonical.adObservations[0] });

    const result = await commitImport({
      canonical, categoryId, datasetName: "dup", actorId: null,
    });

    assert.equal(result.saved.ads, GOLDEN_EXPECTED.uniqueAds, "duplicates collapse before insert");
    const counts = await countAll(client);
    assert.equal(counts.ads, GOLDEN_EXPECTED.uniqueAds);
    assert.equal(counts.ad_observations, GOLDEN_EXPECTED.uniqueAds);
    assert.equal(counts.dataset_ads, GOLDEN_EXPECTED.uniqueAds);
  });
});
