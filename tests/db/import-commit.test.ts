import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import { GOLDEN_EXPECTED, goldenExport } from "../fixtures/load.ts";
import { connect, countAll, goldenCanonical, resetTables, seedCategory } from "./helpers.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds a page the fixture describes inconsistently across the ads that share
 * it, and reports what the first mention says.
 */
function findConflictingPage(): { pageId: string; firstName: string | null } | null {
  const file = goldenExport();
  const rows = file.ads as Record<string, unknown>[];
  const seen = new Map<string, { name: string | null; snapshot: string }>();
  for (const row of rows) {
    const pageId = String(row.page_id);
    const snapshot = JSON.stringify([
      row.page_name, row.page_like_count, row.page_categories, row.page_profile_uri,
    ]);
    const first = seen.get(pageId);
    if (!first) {
      seen.set(pageId, { name: (row.page_name as string) ?? null, snapshot });
      continue;
    }
    if (first.snapshot !== snapshot) return { pageId, firstName: first.name };
  }
  return null;
}

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

  await t.test("E2. conflicting duplicates resolve to the first source occurrence", async () => {
    // Database execution order must never decide which value wins. The rule is
    // fixed in code: first occurrence in source order.
    const build = () => {
      const canonical = goldenCanonical();
      const first = canonical.ads[0];
      const firstObs = canonical.adObservations[0];
      canonical.ads.push({
        ...first,
        isActive: false,
        displayFormat: "CAROUSEL",
        publisherPlatform: ["THREADS"],
        collationId: "second-occurrence",
      });
      canonical.adObservations.push({
        ...firstObs,
        isActive: false,
        displayFormat: "CAROUSEL",
        publisherPlatform: ["THREADS"],
        ctaType: "SECOND_CTA",
        ctaText: "second occurrence",
        bodyText: "second occurrence body",
      });
      return { canonical, first, firstObs };
    };

    const seen: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await resetTables(client);
      const categoryId = await seedCategory(client);
      const { canonical, first, firstObs } = build();
      await commitImport({ canonical, categoryId, datasetName: `dup-${attempt}`, actorId: null });

      const master = await client.query<{
        is_active: boolean | null; display_format: string | null;
        publisher_platform: string[]; collation_id: string | null;
      }>(
        `select is_active, display_format, publisher_platform, collation_id
           from public.ads where ad_archive_id = $1`,
        [first.adArchiveId],
      );
      assert.equal(master.rows.length, 1, "one master only");
      assert.equal(master.rows[0].is_active, first.isActive);
      assert.equal(master.rows[0].display_format, first.displayFormat);
      assert.deepEqual(master.rows[0].publisher_platform, first.publisherPlatform);
      assert.equal(master.rows[0].collation_id, first.collationId);

      const obs = await client.query<{ cta_type: string | null; body_text: string | null }>(
        `select o.cta_type, o.body_text from public.ad_observations o
           join public.ads a on a.id = o.ad_ref where a.ad_archive_id = $1`,
        [first.adArchiveId],
      );
      assert.equal(obs.rows.length, 1, "one observation per run");
      assert.equal(obs.rows[0].cta_type, firstObs.ctaType);
      assert.equal(obs.rows[0].body_text, firstObs.bodyText);
      seen.push(JSON.stringify({ ...master.rows[0], ...obs.rows[0] }));
    }

    assert.equal(new Set(seen).size, 1, "the same input must always resolve identically");
  });

  await t.test("E3. same-run page conflicts resolve to the first occurrence", async () => {
    // The real export disagrees with itself about some pages: 22 differ on
    // page_categories (Thai vs English labels), 8 on page_like_count, 3 on
    // page_name. Resolution must not depend on insert order.
    const conflicting = findConflictingPage();
    assert.ok(conflicting, "the fixture is expected to contain a page conflict");
    const conflictPageId: string = conflicting.pageId;
    const conflictFirstName: string = conflicting.firstName ?? "";

    const snapshots: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await resetTables(client);
      const categoryId = await seedCategory(client);
      const canonical = goldenCanonical();
      await commitImport({ canonical, categoryId, datasetName: `page-${attempt}`, actorId: null });

      const observation = await client.query<{
        page_name: string | null; page_like_count: string | null; page_categories: string[];
      }>(
        `select o.page_name, o.page_like_count::text, o.page_categories
           from public.page_observations o
           join public.pages p on p.id = o.page_ref
          where p.page_id = $1`,
        [conflictPageId],
      );
      assert.equal(observation.rows.length, 1, "one page observation per run");
      snapshots.push(JSON.stringify(observation.rows[0]));
    }

    assert.equal(new Set(snapshots).size, 1, "page resolution must be stable");
    // The winner is the first row in the file that mentions this page.
    assert.match(snapshots[0], new RegExp(escapeRegExp(conflictFirstName)));
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
