import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import { GOLDEN_EXPECTED } from "../fixtures/load.ts";
import { connect, goldenCanonical, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const OLD_RUN = "2026-08-10T00:00:00.000Z";
const NEW_RUN = "2026-08-28T00:00:00.000Z";

test("snapshot read API", { skip }, async (t) => {
  const client = await connect();
  t.after(async () => {
    await resetTables(client);
    await client.end();
    await closePool();
  });

  await t.test("dataset_context reports canonical counts, not reported ones", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const { datasetId } = await commitImport({
      canonical: goldenCanonical(), categoryId, datasetName: "ctx", actorId: null,
    });

    const { rows } = await client.query(
      "select * from public.dataset_context($1)", [datasetId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].computed_unique_ads, 500);
    assert.equal(rows[0].computed_unique_pages, 309);
    assert.equal(Number(rows[0].ads_in_dataset), 500);
    assert.equal(Number(rows[0].quarantine_count), 0);
    assert.equal(rows[0].collection_method, "network_response_observation");
    assert.equal(rows[0].run_status, "completed");
  });

  await t.test("dataset_ads_page carries a total beside every page", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const { datasetId } = await commitImport({
      canonical: goldenCanonical(), categoryId, datasetName: "explorer", actorId: null,
    });

    const page = await client.query(
      "select * from public.dataset_ads_page($1, null, null, null, null, null, null, 30, 0)",
      [datasetId],
    );
    assert.equal(page.rows.length, 30, "page size honoured");
    assert.equal(Number(page.rows[0].total_count), GOLDEN_EXPECTED.uniqueAds,
      "denominator travels with the rows");

    const second = await client.query(
      "select ad_archive_id from public.dataset_ads_page($1, null, null, null, null, null, null, 30, 30)",
      [datasetId],
    );
    const firstIds = new Set(page.rows.map((row) => row.ad_archive_id));
    assert.ok(second.rows.every((row) => !firstIds.has(row.ad_archive_id)), "pages do not overlap");
  });

  await t.test("filters run in the database, including unknown active state", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const canonical = goldenCanonical();
    canonical.ads[0].isActive = null;
    canonical.adObservations[0].isActive = null;
    const { datasetId } = await commitImport({
      canonical, categoryId, datasetName: "filters", actorId: null,
    });

    const q = (active: string | null, extra: unknown[] = [null, null, null, null, null]) =>
      client.query(
        "select ad_archive_id, total_count from public.dataset_ads_page($1,$2,$3,$4,$5,$6,$7,500,0)",
        [datasetId, active, ...extra],
      );

    const unknown = await q("unknown");
    assert.equal(unknown.rows.length, 1, "unknown is filterable on its own");
    const active = await q("active");
    assert.equal(Number(active.rows[0].total_count), 499);
    const inactive = await q("inactive");
    assert.equal(inactive.rows.length, 0);

    const byPlatform = await client.query(
      "select total_count from public.dataset_ads_page($1,null,null,null,$2,null,null,1,0)",
      [datasetId, "FACEBOOK"],
    );
    assert.ok(Number(byPlatform.rows[0].total_count) > 0, "array containment matches");

    const search = await client.query(
      "select total_count from public.dataset_ads_page($1,null,null,null,null,null,$2,1,0)",
      [datasetId, "วิตามิน"],
    );
    assert.ok(Number(search.rows[0].total_count) > 0, "copy search runs in SQL");
  });

  await t.test("facets only offer values present in the snapshot", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const { datasetId } = await commitImport({
      canonical: goldenCanonical(), categoryId, datasetName: "facets", actorId: null,
    });
    const { rows } = await client.query("select * from public.dataset_ads_facets($1)", [datasetId]);
    const platforms = rows.filter((row) => row.facet === "publisher_platform");
    const sum = platforms.reduce((total, row) => total + Number(row.n), 0);
    // publisher_platform is multi-value, so the per-value counts legitimately
    // add up to more than the number of ads.
    assert.ok(sum > GOLDEN_EXPECTED.uniqueAds, "multi-value counts exceed the row count");
    assert.ok(rows.some((row) => row.facet === "active" && row.value === "active"));
  });

  await t.test("an older dataset keeps its own values after a newer import", async () => {
    // The core UI proof of I1: importing a newer run must not rewrite what an
    // existing dataset shows.
    await resetTables(client);
    const categoryId = await seedCategory(client);

    const oldRun = await commitImport({
      canonical: singleAdCanonical({
        collectedAt: OLD_RUN, isActive: true, displayFormat: "IMAGE",
        publisherPlatform: ["FACEBOOK"],
      }),
      categoryId, datasetName: "old-dataset", actorId: null,
    });

    const before = await client.query(
      "select is_active, display_format from public.dataset_ads_page($1,null,null,null,null,null,null,10,0)",
      [oldRun.datasetId],
    );
    assert.equal(before.rows[0].display_format, "IMAGE");

    const newRun = await commitImport({
      canonical: singleAdCanonical({
        collectedAt: NEW_RUN, isActive: false, displayFormat: "VIDEO",
        publisherPlatform: ["INSTAGRAM"],
      }),
      categoryId, datasetName: "new-dataset", actorId: null,
    });

    const oldAfter = await client.query(
      "select is_active, display_format, publisher_platform from public.dataset_ads_page($1,null,null,null,null,null,null,10,0)",
      [oldRun.datasetId],
    );
    assert.equal(oldAfter.rows[0].display_format, "IMAGE", "old dataset must not move");
    assert.equal(oldAfter.rows[0].is_active, true);
    assert.deepEqual(oldAfter.rows[0].publisher_platform, ["FACEBOOK"]);

    const newAfter = await client.query(
      "select is_active, display_format from public.dataset_ads_page($1,null,null,null,null,null,null,10,0)",
      [newRun.datasetId],
    );
    assert.equal(newAfter.rows[0].display_format, "VIDEO", "new dataset shows the new run");
    assert.equal(newAfter.rows[0].is_active, false);

    // The same split must hold in the drawer.
    const adId = "900000000000001";
    const oldDrawer = await client.query(
      "select context, display_format, is_active from public.ad_detail($1,$2)",
      [adId, oldRun.datasetId],
    );
    assert.equal(oldDrawer.rows[0].context, "dataset");
    assert.equal(oldDrawer.rows[0].display_format, "IMAGE");

    const master = await client.query(
      "select context, display_format, is_active from public.ad_detail($1,null)", [adId],
    );
    assert.equal(master.rows[0].context, "master");
    assert.equal(master.rows[0].display_format, "VIDEO", "master shows the newest state");
    assert.equal(master.rows[0].is_active, false);
  });

  await t.test("an ad outside the dataset returns nothing instead of falling back", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const a = await commitImport({
      canonical: singleAdCanonical({ collectedAt: OLD_RUN, adArchiveId: "111", pageId: "p1" }),
      categoryId, datasetName: "ds-a", actorId: null,
    });
    await commitImport({
      canonical: singleAdCanonical({ collectedAt: OLD_RUN, adArchiveId: "222", pageId: "p2" }),
      categoryId, datasetName: "ds-b", actorId: null,
    });

    const foreign = await client.query("select * from public.ad_detail($1,$2)", ["222", a.datasetId]);
    assert.equal(foreign.rows.length, 0, "membership is required; the route answers 404");

    const own = await client.query("select * from public.ad_detail($1,$2)", ["111", a.datasetId]);
    assert.equal(own.rows.length, 1);
  });

  await t.test("observation history is newest first and names its run", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    for (const collectedAt of [OLD_RUN, NEW_RUN]) {
      await commitImport({
        canonical: singleAdCanonical({ collectedAt, displayFormat: collectedAt === OLD_RUN ? "IMAGE" : "VIDEO" }),
        categoryId, datasetName: `hist-${collectedAt}`, actorId: null,
      });
    }
    const { rows } = await client.query(
      "select * from public.ad_observation_history($1)", ["900000000000001"],
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].observed_at.toISOString(), NEW_RUN);
    assert.equal(rows[1].observed_at.toISOString(), OLD_RUN);
    assert.ok(rows.every((row) => row.collection_run_id && row.collection_method));
  });
});
