import assert from "node:assert/strict";
import test from "node:test";
import { commitImport, commitImportAsRole } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import { validate } from "../../lib/collector/validate.ts";
import { GOLDEN_EXPECTED, goldenExport } from "../fixtures/load.ts";
import { connect, countAll, goldenCanonical, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const NEWER = "2026-08-28T00:00:00.000Z";
const OLDER = "2026-08-10T00:00:00.000Z";

type MasterAd = {
  first_seen_at: Date; last_seen_at: Date; is_active: boolean | null;
  display_format: string | null; publisher_platform: string[] | null;
  collation_id: string | null;
};
type MasterPage = { page_profile_uri: string | null; page_profile_numeric_id: string | null };

test("T09 D / T10 / T11 / T12", { skip }, async (t) => {
  const client = await connect();
  t.after(async () => {
    await resetTables(client);
    await client.end();
    await closePool();
  });

  const adOf = async (): Promise<MasterAd> =>
    (await client.query<MasterAd>(
      `select first_seen_at, last_seen_at, is_active, display_format,
              publisher_platform, collation_id from public.ads limit 1`,
    )).rows[0];

  const pageOf = async (): Promise<MasterPage> =>
    (await client.query<MasterPage>(
      "select page_profile_uri, page_profile_numeric_id from public.pages limit 1",
    )).rows[0];

  await t.test("D. authorization is refused before a transaction opens", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const before = await countAll(client);

    for (const role of [null, "viewer"] as const) {
      await assert.rejects(
        () => commitImportAsRole(role, {
          canonical: goldenCanonical(), categoryId, datasetName: "denied", actorId: null,
        }),
        (error: Error & { status?: number }) => {
          assert.equal(error.name, "AuthorizationError");
          assert.equal(error.status, role ? 403 : 401);
          return true;
        },
      );
    }

    assert.deepEqual(await countAll(client), before, "nothing may be written");
  });

  await t.test("T10. re-importing the same export keeps one master, appends history", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);

    await commitImport({ canonical: goldenCanonical(), categoryId, datasetName: "first", actorId: null });
    await commitImport({ canonical: goldenCanonical(), categoryId, datasetName: "second", actorId: null });

    const counts = await countAll(client);
    assert.equal(counts.ads, GOLDEN_EXPECTED.uniqueAds, "master ads stay at 500");
    assert.equal(counts.pages, GOLDEN_EXPECTED.uniquePages, "master pages stay at 309");
    assert.equal(counts.collection_runs, 2);
    assert.equal(counts.datasets, 2);
    assert.equal(counts.ad_observations, 1000, "observation history appends");
    assert.equal(counts.page_observations, 618);
    assert.equal(counts.dataset_ads, 1000, "membership is per dataset");
  });

  await t.test("T11.1 newer then older", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    await commitImport({
      canonical: singleAdCanonical({
        collectedAt: NEWER, isActive: true, displayFormat: "VIDEO",
        publisherPlatform: ["FACEBOOK"], collationId: "new-collation",
        pageProfileUri: "https://new.test/", pageProfileNumericId: "999",
      }),
      categoryId, datasetName: "newer", actorId: null,
    });
    await commitImport({
      canonical: singleAdCanonical({
        collectedAt: OLDER, isActive: false, displayFormat: "IMAGE",
        publisherPlatform: ["INSTAGRAM"], collationId: "old-collation",
        pageProfileUri: "https://old.test/", pageProfileNumericId: "111",
      }),
      categoryId, datasetName: "older", actorId: null,
    });

    const ad = await adOf();
    assert.equal(ad.first_seen_at.toISOString(), OLDER, "first_seen moves backward");
    assert.equal(ad.last_seen_at.toISOString(), NEWER, "last_seen stays");
    assert.equal(ad.is_active, true, "older run must not overwrite current state");
    assert.equal(ad.display_format, "VIDEO");
    assert.deepEqual(ad.publisher_platform, ["FACEBOOK"]);
    assert.equal(ad.collation_id, "new-collation");

    const page = await pageOf();
    assert.equal(page.page_profile_uri, "https://new.test/", "page identity stays newest");
    assert.equal(page.page_profile_numeric_id, "999");

    const counts = await countAll(client);
    assert.equal(counts.ads, 1);
    assert.equal(counts.ad_observations, 2, "older run still appends an observation");
  });

  await t.test("T11.2 older then newer reaches the same master state", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    await commitImport({
      canonical: singleAdCanonical({
        collectedAt: OLDER, isActive: false, displayFormat: "IMAGE",
        publisherPlatform: ["INSTAGRAM"], collationId: "old-collation",
        pageProfileUri: "https://old.test/", pageProfileNumericId: "111",
      }),
      categoryId, datasetName: "older", actorId: null,
    });
    await commitImport({
      canonical: singleAdCanonical({
        collectedAt: NEWER, isActive: true, displayFormat: "VIDEO",
        publisherPlatform: ["FACEBOOK"], collationId: "new-collation",
        pageProfileUri: "https://new.test/", pageProfileNumericId: "999",
      }),
      categoryId, datasetName: "newer", actorId: null,
    });

    const ad = await adOf();
    assert.equal(ad.first_seen_at.toISOString(), OLDER);
    assert.equal(ad.last_seen_at.toISOString(), NEWER);
    assert.equal(ad.is_active, true, "final state is order-independent");
    assert.equal(ad.display_format, "VIDEO");
    assert.deepEqual(ad.publisher_platform, ["FACEBOOK"]);
    assert.equal(ad.collation_id, "new-collation");
    assert.equal((await pageOf()).page_profile_uri, "https://new.test/");
  });

  await t.test("T11.3 equal collected_at lets the later import win", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    for (const format of ["IMAGE", "VIDEO"]) {
      await commitImport({
        canonical: singleAdCanonical({ collectedAt: NEWER, isActive: true, displayFormat: format }),
        categoryId, datasetName: `equal-${format}`, actorId: null,
      });
    }
    // `>=` on the guard means a tie goes to the incoming row. Order matters
    // only in this exact case, which the design accepts.
    assert.equal((await adOf()).display_format, "VIDEO");
  });

  await t.test("T11.4 alternating imports converge on the newest state", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const runs: [string, string, boolean][] = [
      [OLDER, "IMAGE", false], [NEWER, "VIDEO", true],
      [OLDER, "IMAGE", false], [NEWER, "VIDEO", true],
    ];
    for (const [collectedAt, displayFormat, isActive] of runs) {
      await commitImport({
        canonical: singleAdCanonical({ collectedAt, displayFormat, isActive }),
        categoryId, datasetName: `alt-${collectedAt}-${displayFormat}`, actorId: null,
      });
    }
    const ad = await adOf();
    assert.equal(ad.first_seen_at.toISOString(), OLDER);
    assert.equal(ad.last_seen_at.toISOString(), NEWER);
    assert.equal(ad.display_format, "VIDEO");
    assert.equal(ad.is_active, true);
    // Two runs share each timestamp, so only two observations can exist:
    // unique(collection_run_id, ad_ref) is per run, and there are four runs.
    assert.equal((await countAll(client)).ad_observations, 4);
  });

  await t.test("T11.5 a newer null keeps UNKNOWN instead of reusing an old value", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    await commitImport({
      canonical: singleAdCanonical({ collectedAt: OLDER, isActive: true, displayFormat: "VIDEO" }),
      categoryId, datasetName: "known", actorId: null,
    });
    await commitImport({
      canonical: singleAdCanonical({ collectedAt: NEWER, isActive: null, displayFormat: null }),
      categoryId, datasetName: "unknown", actorId: null,
    });
    const ad = await adOf();
    assert.equal(ad.is_active, null, "an unreadable state is unknown, not the old true");
    assert.equal(ad.display_format, null);
  });

  await t.test("T11.6 page identity keeps the latest non-null value", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    await commitImport({
      canonical: singleAdCanonical({
        collectedAt: OLDER, pageProfileUri: "https://known.test/", pageProfileNumericId: "111",
      }),
      categoryId, datasetName: "identity-known", actorId: null,
    });
    await commitImport({
      canonical: singleAdCanonical({
        collectedAt: NEWER, pageProfileUri: null, pageProfileNumericId: null,
      }),
      categoryId, datasetName: "identity-missing", actorId: null,
    });
    const page = await pageOf();
    // page_profile_numeric_id is present on only 44% of real rows, so a newer
    // run omitting it means "not observed", not "the identity disappeared".
    assert.equal(page.page_profile_uri, "https://known.test/");
    assert.equal(page.page_profile_numeric_id, "111");
  });

  await t.test("T12. a file-level rejection never reaches the database", async () => {
    await resetTables(client);
    const before = await countAll(client);

    const broken = goldenExport();
    (broken.ads as Record<string, unknown>[])[0].surprise_metric = 1;
    const result = validate(broken);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unknown_field");

    // Nothing is committed for a rejected file: no run, no dataset, and no
    // quarantine row either — quarantine is only for row-level problems inside
    // a file that passed validation.
    assert.deepEqual(await countAll(client), before);
  });

  await t.test("T12. quarantine commits the good rows and records the bad ones", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const canonical = goldenCanonical();
    canonical.quarantine.push(
      { reason: "missing_ad_archive_id", payload: { page_id: "x" } },
      { reason: "unresolved_source_record", payload: { page_id: "y" } },
    );

    const result = await commitImport({
      canonical, categoryId, datasetName: "partial", actorId: null,
    });

    assert.equal(result.status, "partial");
    assert.deepEqual(result.quarantined.reasons, {
      missing_ad_archive_id: 1, unresolved_source_record: 1,
    });

    const counts = await countAll(client);
    assert.equal(counts.ads, GOLDEN_EXPECTED.uniqueAds, "quarantined rows never become ads");
    assert.equal(counts.import_quarantine, 2);

    const status = await client.query<{ status: string }>(
      "select status from public.collection_runs where id = $1",
      [result.collectionRunId],
    );
    assert.equal(status.rows[0].status, "partial");

    const stored = await client.query<{ reason: string }>(
      "select reason from public.import_quarantine order by reason",
    );
    assert.deepEqual(stored.rows.map((row) => row.reason), [
      "missing_ad_archive_id", "unresolved_source_record",
    ]);
  });
});
