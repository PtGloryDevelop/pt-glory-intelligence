import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import type { CanonicalImport } from "../../lib/domain/types.ts";
import { GOLDEN_EXPECTED } from "../fixtures/load.ts";
import { connect, goldenCanonical, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * The Explorer read layer (migration 0022).
 *
 * Everything the toolbar and the advanced panel can ask for runs here, in SQL,
 * against the dataset's own snapshot. These cases pin the behaviour that a
 * filter is easy to get subtly wrong on: unknown staying its own state,
 * presence meaning "the collector read it", evergreen needing both halves, and
 * a sort key never becoming a column name.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

const ARGS =
  "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25";

type PageArgs = {
  active?: string | null; format?: string | null; cta?: string | null;
  platform?: string | null; category?: string | null; search?: string | null;
  limit?: number; offset?: number; page?: string | null;
  startedFrom?: string | null; startedTo?: string | null;
  firstSeenFrom?: string | null; firstSeenTo?: string | null;
  lastSeenFrom?: string | null; lastSeenTo?: string | null;
  ageMin?: number | null; ageMax?: number | null;
  evergreen?: boolean | null; reuseMin?: number | null;
  hasVideo?: boolean | null; hasImage?: boolean | null;
  hasTitle?: boolean | null; hasDestination?: boolean | null;
  sort?: string;
};

const params = (datasetId: string, a: PageArgs = {}) => [
  datasetId, a.active ?? null, a.format ?? null, a.cta ?? null, a.platform ?? null,
  a.category ?? null, a.search ?? null, a.limit ?? 30, a.offset ?? 0, a.page ?? null,
  a.startedFrom ?? null, a.startedTo ?? null, a.firstSeenFrom ?? null, a.firstSeenTo ?? null,
  a.lastSeenFrom ?? null, a.lastSeenTo ?? null, a.ageMin ?? null, a.ageMax ?? null,
  a.evergreen ?? null, a.reuseMin ?? null, a.hasVideo ?? null, a.hasImage ?? null,
  a.hasTitle ?? null, a.hasDestination ?? null, a.sort ?? "started_desc",
];

/**
 * Three ads that differ in exactly the ways the advanced filters ask about:
 * media, title, destination, reuse count, age and active state.
 */
function mixedCanonical(): CanonicalImport {
  const canonical = singleAdCanonical({ collectedAt: "2026-08-20T00:00:00.000Z", isActive: true });
  const [page] = canonical.pages;
  const [pageObservation] = canonical.pageObservations;
  const [ad] = canonical.ads;
  const [observation] = canonical.adObservations;

  // Ad 1: old, active, image, title, destination, reused.
  ad.startDate = "2020-01-01T00:00:00.000Z";
  observation.title = "หัวเรื่องจริง";
  observation.linkUrl = "https://example.test/landing";
  observation.collationCount = 7;
  observation.media = { images: [{ url: "https://cdn.example.test/a.jpg" }], videos: [], cards: [] };

  // Ad 2: recent, inactive, video only, no title, no destination, not reused.
  const second = { ...ad, adArchiveId: "900000000000002", startDate: "2026-08-01T00:00:00.000Z", isActive: false };
  const secondObservation = {
    ...observation,
    adArchiveId: "900000000000002",
    isActive: false,
    title: null,
    linkUrl: null,
    collationCount: 1,
    media: { images: [], videos: [{ url: "https://cdn.example.test/b.mp4" }], cards: [] },
    provenance: { ...observation.provenance, recordKey: "ad:900000000000002" },
  };

  // Ad 3: old, unknown state, no media at all, on a second page.
  const third = {
    ...ad, adArchiveId: "900000000000003", pageId: "910000000000002",
    startDate: "2020-06-01T00:00:00.000Z", isActive: null,
  };
  const thirdObservation = {
    ...observation,
    adArchiveId: "900000000000003",
    isActive: null,
    title: "   ",           // blank is absent, exactly as isPresent says
    linkUrl: null,
    collationCount: null,
    media: { images: [], videos: [], cards: [] },
    provenance: { ...observation.provenance, recordKey: "ad:900000000000003" },
  };

  canonical.pages = [page, { ...page, pageId: "910000000000002" }];
  canonical.pageObservations = [
    pageObservation,
    { ...pageObservation, pageId: "910000000000002", pageName: "Second Page", pageCategories: ["Retail"] },
  ];
  canonical.ads = [ad, second, third];
  canonical.adObservations = [observation, secondObservation, thirdObservation];
  canonical.run.reported = { sourceRows: 3, uniqueAds: 3, uniquePages: 2, unresolvedCount: 0, qualitySummary: null };
  canonical.run.computed = { sourceRows: 3, uniqueAds: 3, uniquePages: 2, unresolvedCount: 0 };
  return canonical;
}

test("explorer read layer", { skip }, async (t) => {
  const client = await connect();
  const page = (datasetId: string, args?: PageArgs) =>
    client.query(`select * from public.dataset_ads_page(${ARGS})`, params(datasetId, args));

  t.after(async () => {
    await resetTables(client);
    await client.end();
    await closePool();
  });

  let mixedId = "";
  let goldenId = "";

  await t.test("seed", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    mixedId = (await commitImport({
      canonical: mixedCanonical(), categoryId, datasetName: "mixed", actorId: null,
    })).datasetId;
    goldenId = (await commitImport({
      canonical: goldenCanonical({ collectedAt: "2026-08-28T00:00:00.000Z" }),
      categoryId, datasetName: "golden", actorId: null,
    })).datasetId;
  });

  await t.test("active true, false and unknown are three separate sets", async () => {
    const active = await page(mixedId, { active: "active" });
    const inactive = await page(mixedId, { active: "inactive" });
    const unknown = await page(mixedId, { active: "unknown" });
    assert.deepEqual(active.rows.map((r) => r.ad_archive_id), ["900000000000001"]);
    assert.deepEqual(inactive.rows.map((r) => r.ad_archive_id), ["900000000000002"]);
    assert.deepEqual(unknown.rows.map((r) => r.ad_archive_id), ["900000000000003"]);
    assert.equal(active.rows.length + inactive.rows.length + unknown.rows.length, 3,
      "no ad belongs to two of them, and none is dropped");
  });

  await t.test("page filter matches on id, not on name", async () => {
    const { rows } = await page(mixedId, { page: "910000000000002" });
    assert.deepEqual(rows.map((r) => r.ad_archive_id), ["900000000000003"]);
    assert.equal(rows[0].page_name, "Second Page");
  });

  await t.test("page category, format, cta and platform still filter in SQL", async () => {
    const category = await page(mixedId, { category: "Retail" });
    assert.equal(category.rows.length, 1);

    const format = await page(goldenId, { format: "IMAGE" });
    assert.ok(format.rows.every((row) => row.display_format === "IMAGE"));
    assert.ok(Number(format.rows[0].total_count) < GOLDEN_EXPECTED.uniqueAds, "the filter narrowed the set");

    const platform = await page(goldenId, { platform: "FACEBOOK" });
    assert.ok(platform.rows.every((row) => row.publisher_platform.includes("FACEBOOK")));
  });

  await t.test("date ranges: start_date and first_seen_at are not interchangeable", async () => {
    const started = await page(mixedId, { startedFrom: "2026-01-01T00:00:00.000Z" });
    assert.deepEqual(started.rows.map((r) => r.ad_archive_id), ["900000000000002"]);

    // Every ad in this dataset was first seen in the same run, so a first_seen
    // window that excludes the run must return nothing even though start_date
    // would have matched.
    const firstSeen = await page(mixedId, { firstSeenTo: "2019-01-01T00:00:00.000Z" });
    assert.equal(firstSeen.rows.length, 0);

    const seenInRun = await page(mixedId, { firstSeenFrom: "2026-08-01T00:00:00.000Z" });
    assert.equal(seenInRun.rows.length, 3);

    const lastSeen = await page(mixedId, { lastSeenFrom: "2026-08-01T00:00:00.000Z" });
    assert.equal(lastSeen.rows.length, 3);
  });

  await t.test("ad age range", async () => {
    const old = await page(mixedId, { ageMin: 1000 });
    assert.deepEqual(
      old.rows.map((r) => r.ad_archive_id).sort(),
      ["900000000000001", "900000000000003"],
    );
    const recent = await page(mixedId, { ageMax: 400 });
    assert.deepEqual(recent.rows.map((r) => r.ad_archive_id), ["900000000000002"]);
  });

  await t.test("evergreen needs both halves: running, and old enough", async () => {
    const threshold = await client.query<{ days: number }>(
      "select public.evergreen_threshold_days() as days",
    );
    assert.equal(threshold.rows[0].days, 90, "the rule stays configured in app_settings");

    const evergreen = await page(mixedId, { evergreen: true });
    // Ad 3 is just as old but its state is unknown, so it does not qualify.
    assert.deepEqual(evergreen.rows.map((r) => r.ad_archive_id), ["900000000000001"]);

    const notEvergreen = await page(mixedId, { evergreen: false });
    assert.deepEqual(
      notEvergreen.rows.map((r) => r.ad_archive_id).sort(),
      ["900000000000002", "900000000000003"],
    );
  });

  await t.test("creative reuse reads the stored collation count", async () => {
    const reused = await page(mixedId, { reuseMin: 2 });
    assert.deepEqual(reused.rows.map((r) => r.ad_archive_id), ["900000000000001"]);
    assert.equal(reused.rows[0].collation_count, 7);
  });

  await t.test("presence filters follow isPresent: blank and empty are absent", async () => {
    const hasTitle = await page(mixedId, { hasTitle: true });
    assert.deepEqual(hasTitle.rows.map((r) => r.ad_archive_id), ["900000000000001"],
      "a whitespace-only title is not a title");

    const noTitle = await page(mixedId, { hasTitle: false });
    assert.equal(noTitle.rows.length, 2);

    const hasDestination = await page(mixedId, { hasDestination: true });
    assert.deepEqual(hasDestination.rows.map((r) => r.ad_archive_id), ["900000000000001"]);

    const hasImage = await page(mixedId, { hasImage: true });
    assert.deepEqual(hasImage.rows.map((r) => r.ad_archive_id), ["900000000000001"]);

    const hasVideo = await page(mixedId, { hasVideo: true });
    assert.deepEqual(hasVideo.rows.map((r) => r.ad_archive_id), ["900000000000002"]);
  });

  await t.test("filters combine, and the total counts the combination", async () => {
    const { rows } = await page(mixedId, { active: "active", hasImage: true, reuseMin: 2 });
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].total_count), 1);

    const impossible = await page(mixedId, { active: "active", hasVideo: true });
    assert.equal(impossible.rows.length, 0, "an empty result is a real answer");
  });

  await t.test("every sort key orders by what it claims", async () => {
    const ids = async (sort: string) =>
      (await page(mixedId, { sort })).rows.map((row) => row.ad_archive_id);

    assert.deepEqual(await ids("started_desc"),
      ["900000000000002", "900000000000003", "900000000000001"]);
    assert.deepEqual(await ids("started_asc"),
      ["900000000000001", "900000000000003", "900000000000002"]);
    assert.deepEqual(await ids("longest_running"),
      ["900000000000001", "900000000000003", "900000000000002"]);
    assert.deepEqual((await ids("most_reused"))[0], "900000000000001");
    // Ordering Page before Second Page; inside a page the default start_date
    // tiebreak still applies.
    assert.deepEqual(await ids("page_name"),
      ["900000000000002", "900000000000001", "900000000000003"]);
  });

  await t.test("an unrecognised sort key falls back to the default ordering", async () => {
    // The route rejects it with a 400 before this; the function must still be
    // deterministic rather than ordering by whatever the planner chose.
    const injected = await page(mixedId, { sort: "start_date; drop table public.ads" });
    assert.deepEqual(
      injected.rows.map((r) => r.ad_archive_id),
      ["900000000000002", "900000000000003", "900000000000001"],
    );
    const stillThere = await client.query("select count(*)::int as n from public.ads");
    assert.equal(stillThere.rows[0].n, 503, "the sort key is never executed as SQL");
  });

  await t.test("pagination keeps its filter and reports the filtered total", async () => {
    const first = await page(goldenId, { format: "IMAGE", limit: 10, offset: 0 });
    const second = await page(goldenId, { format: "IMAGE", limit: 10, offset: 10 });
    const total = Number(first.rows[0].total_count);
    assert.equal(Number(second.rows[0].total_count), total, "the denominator does not move between pages");
    const firstIds = new Set(first.rows.map((row) => row.ad_archive_id));
    assert.ok(second.rows.every((row) => !firstIds.has(row.ad_archive_id)), "pages do not overlap");
    assert.ok(second.rows.every((row) => row.display_format === "IMAGE"), "page two keeps the filter");
  });

  await t.test("media comes from this dataset's own run, never the newest one", async () => {
    const categoryId = await seedCategory(client, "snapshot");
    const oldCanonical = singleAdCanonical({ collectedAt: "2026-08-10T00:00:00.000Z", displayFormat: "IMAGE" });
    oldCanonical.adObservations[0].media = {
      images: [{ url: "https://cdn.example.test/old.jpg" }], videos: [], cards: [],
    };
    const { datasetId: oldId } = await commitImport({
      canonical: oldCanonical, categoryId, datasetName: "snap-old", actorId: null,
    });

    const newCanonical = singleAdCanonical({ collectedAt: "2026-08-28T00:00:00.000Z", displayFormat: "VIDEO" });
    newCanonical.adObservations[0].media = {
      images: [], videos: [{ url: "https://cdn.example.test/new.mp4" }], cards: [],
    };
    await commitImport({ canonical: newCanonical, categoryId, datasetName: "snap-new", actorId: null });

    const { rows } = await page(oldId);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].media.images, [{ url: "https://cdn.example.test/old.jpg" }],
      "the old dataset keeps the media observed in its own run");
    assert.deepEqual(rows[0].media.videos, []);
  });

  await t.test("facets come from the snapshot and carry a label", async () => {
    const { rows } = await client.query("select * from public.dataset_ads_facets($1)", [mixedId]);
    const of = (facet: string) => rows.filter((row) => row.facet === facet);

    const active = of("active");
    assert.deepEqual(
      active.map((row) => row.value).sort(),
      ["active", "inactive", "unknown"],
      "unknown is offered as its own option",
    );

    const pages = of("page");
    assert.equal(pages.length, 2);
    const second = pages.find((row) => row.value === "910000000000002");
    assert.equal(second.label, "Second Page", "filter by id, offer by name");
    assert.equal(Number(second.n), 1);

    // These ads carry no display_format, so the only option offered is the
    // em dash. A value from some other run must never appear in this list.
    assert.deepEqual(of("display_format").map((row) => row.value), ["—"]);
  });
});
