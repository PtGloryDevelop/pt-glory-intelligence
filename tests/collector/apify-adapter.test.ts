import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { COLLECTION_METHOD, adaptApifyItems, type AdapterInput } from "../../lib/collect/adapter.ts";
import { buildAdLibraryUrl } from "../../lib/collect/url.ts";
import { AD_KEYS, FORBIDDEN_KEYS, MAX_BYTES } from "../../lib/collector/contract.ts";
import { validate } from "../../lib/collector/validate.ts";
import { analyzeImport } from "../../lib/import/analyze.ts";

/**
 * C02 — the Apify adapter against the C01 qualification sample.
 *
 * apify-sample-59.json: the owner's 59-item Console run, fbcdn signatures
 * stripped, forbidden fields kept so dropping them is really tested.
 * extension-overlap-apify.json: the Extension's 2026-09-10 rows for the 27 ads
 * both collectors saw, as a valid PT Glory export.
 */

type Row = Record<string, unknown>;
type ExportFile = {
  generated_at: string;
  scope: Row;
  source: Row;
  stop_reason: unknown;
  quality_summary: Row & { unresolved_reasons: Record<string, number>; forbidden_key_names: string[] };
  ads: Row[];
  unresolved_ads: Row[];
};

const fixture = (name: string) => readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");
const SAMPLE_TEXT = fixture("apify-sample-59.json");
const EXTENSION_TEXT = fixture("extension-overlap-apify.json");
const sample = (): Row[] => JSON.parse(SAMPLE_TEXT);

const QUERY = "วิตามินสลายไขมัน";
const GENERATED_AT = "2026-09-11T07:35:00.000Z";
const FORBIDDEN_IN_SAMPLE = ["currency", "impressions_with_index", "reach_estimate", "spend", "total_active_time"];

function input(overrides: Partial<AdapterInput> = {}): AdapterInput {
  return {
    items: sample(),
    collectionRequestId: "0b6f2c1e-9a4d-4e5f-8c7b-2d1a3e4f5a6b",
    scope: { country: "TH", query: QUERY, activeStatus: "active" },
    sourceUrl: buildAdLibraryUrl({ country: "TH", query: QUERY, activeStatus: "active" }),
    maxRecords: 100,
    maxExportBytes: MAX_BYTES,
    generatedAt: GENERATED_AT,
    stop: { runSucceeded: true, ceilingReached: false, guardStopped: false, exhaustionEvidence: false },
    ...overrides,
  };
}

function adapt(overrides: Partial<AdapterInput> = {}): { text: string; file: ExportFile } {
  const result = adaptApifyItems(input(overrides));
  if (!result.ok) assert.fail(`adapter refused: ${result.detail}`);
  return { text: result.text, file: JSON.parse(result.text) as ExportFile };
}

/** The adapter's own method, accepted by the validator since migration 0037. */
function assertsMethod(text: string): string {
  assert.equal((JSON.parse(text) as { source: { collection_method: string } }).source.collection_method, COLLECTION_METHOD);
  return text;
}

/** A minimal synthetic Apify item, shaped like the sample, with recognisable forbidden values. */
function apifyItem(overrides: Row = {}, snapshot: Row = {}): Row {
  return {
    ad_archive_id: "900000000000001",
    page_id: "800000000000001",
    page_name: "Synthetic Page",
    collation_id: "700000000000001",
    collation_count: 2,
    is_active: true,
    start_date: 1757548800, // 2025-09-11T00:00:00Z
    end_date: 1757635200, // 2025-09-12T00:00:00Z
    publisher_platform: ["FACEBOOK", "INSTAGRAM"],
    spend: "SYNTHETIC-SPEND-VALUE",
    currency: "SYNTHETIC-CURRENCY-VALUE",
    reach_estimate: 424242,
    impressions_with_index: { impressions_text: "SYNTHETIC-IMPRESSIONS-VALUE", impressions_index: 7 },
    total_active_time: 313373,
    total: 1475,
    snapshot: {
      page_like_count: 1234,
      page_categories: ["Health/beauty", "Shopping & retail"],
      page_profile_uri: "https://www.facebook.com/synthetic.page/",
      display_format: "IMAGE",
      cta_type: "MESSAGE_PAGE",
      cta_text: "Send message",
      title: null,
      body: { text: "Synthetic body" },
      caption: null,
      link_url: null,
      link_description: null,
      images: [{
        original_image_url: "https://scontent.example.fbcdn.net/o.jpg",
        resized_image_url: "https://scontent.example.fbcdn.net/r.jpg",
        watermarked_resized_image_url: "https://scontent.example.fbcdn.net/w.jpg",
        image_crops: [],
      }],
      videos: [],
      cards: [],
      country_iso_code: "US",
      ...snapshot,
    },
    ...overrides,
  };
}

// --- The export contract -------------------------------------------------------

test("the validator accepts apify_actor_run, added by migration 0037", () => {
  const result = validate(adapt().file);
  assert.equal(result.ok ? "ok" : result.reason, "ok");
});

test("the qualification sample becomes a valid PT Glory export", () => {
  const items = sample();
  const result = validate(JSON.parse(assertsMethod(adapt().text)));
  if (!result.ok) assert.fail(`${result.reason}: ${result.detail}`);
  assert.deepEqual(result.computed, {
    sourceRows: 59,
    uniqueAds: 59,
    uniquePages: new Set(items.map((item) => item.page_id)).size,
    unresolvedCount: 0,
  });
  assert.deepEqual(result.reported, result.computed);
});

test("rows carry only contract keys, and no forbidden field keeps its name", () => {
  const { file } = adapt();
  for (const row of [...file.ads, ...file.unresolved_ads]) {
    for (const key of Object.keys(row)) {
      assert.ok((AD_KEYS as readonly string[]).includes(key), `unexpected row key ${key}`);
    }
  }
  const rows = JSON.stringify([file.ads, file.unresolved_ads]);
  for (const key of FORBIDDEN_IN_SAMPLE) assert.doesNotMatch(rows, new RegExp(`"${key}"\\s*:`), key);
  assert.deepEqual(file.quality_summary.forbidden_key_names, FORBIDDEN_IN_SAMPLE);
  // The two groups are counted apart: names on the frozen FORBIDDEN_KEYS list,
  // and ordinary provider fields simply outside the canonical allowlist.
  assert.equal(file.quality_summary.discarded_key_count, 48);
  for (const key of FORBIDDEN_IN_SAMPLE) {
    assert.ok(FORBIDDEN_KEYS.includes(key as (typeof FORBIDDEN_KEYS)[number]), `${key} must be a frozen forbidden key`);
  }
});

test("forbidden values never reach the export, though their names are kept as diagnostics", () => {
  const { text, file } = adapt({ items: [apifyItem()] });
  for (const value of ["SYNTHETIC-SPEND-VALUE", "SYNTHETIC-CURRENCY-VALUE", "SYNTHETIC-IMPRESSIONS-VALUE", "424242", "313373"]) {
    assert.ok(!text.includes(value), `${value} leaked`);
  }
  assert.deepEqual(file.quality_summary.forbidden_key_names, FORBIDDEN_IN_SAMPLE);
});

test("cta_type is the canonical CTA; cta_text is the provider's own presentation", () => {
  const thai = adapt({ items: [apifyItem({}, { cta_text: "ส่งข้อความ" })] }).file.ads[0];
  const english = adapt({ items: [apifyItem({}, { cta_text: "Send message" })] }).file.ads[0];
  assert.equal(thai.cta_type, english.cta_type);
  assert.notEqual(thai.cta_text, english.cta_text);
  // No translation and no English→Thai mapping lives in this adapter.
  assert.equal(thai.cta_text, "ส่งข้อความ");
});

test("quality_summary carries the request ID and counts, never provider identity or cost", () => {
  const { file } = adapt();
  assert.deepEqual(Object.keys(file.quality_summary), [
    "collection_request_id", "provider_item_count", "duplicates_removed", "unresolved_reasons",
    "discarded_key_count", "forbidden_key_names",
  ]);
  assert.equal(file.quality_summary.collection_request_id, input().collectionRequestId);
  assert.equal(file.quality_summary.provider_item_count, 59);
  assert.doesNotMatch(JSON.stringify(file.quality_summary), /apify|actor|run_?id|usd|cost|charge/i);
  assert.equal(file.source.product, "PT Glory Collector");
  assert.doesNotMatch(String(file.source.completeness_claim), /apify/i);
  assert.equal(file.generated_at, GENERATED_AT);
});

// --- Dates -----------------------------------------------------------------------

test("epoch seconds become ISO 8601 UTC; an active ad's end date is raw provenance only", () => {
  const [row] = adapt({ items: [apifyItem()] }).file.ads;
  assert.equal(row.start_date, "2025-09-11T00:00:00.000Z");
  assert.equal(row.start_date_raw, "2025-09-11T00:00:00.000Z");
  assert.equal(row.end_date, null);
  assert.equal(row.network_end_date_raw, "2025-09-12T00:00:00.000Z");
});

test("text fields follow the collector's whitespace rule; URLs keep their characters", () => {
  const [row] = adapt({ items: [apifyItem({}, {
    title: "   ",
    body: { text: "line one\n\nline  two \t" },
    link_url: " https://example.test/a?b=c ",
    caption: "keeps 𝟭,𝟵𝟵𝟵",
  })] }).file.ads;
  assert.equal(row.body_text, "line one line two");
  assert.equal(row.title, null);
  assert.equal(row.link_url, "https://example.test/a?b=c");
  assert.equal(row.caption, "keeps 𝟭,𝟵𝟵𝟵", "NFKC is not applied");
});

test("an inactive ad keeps a valid upstream end date", () => {
  const [row] = adapt({ items: [apifyItem({ is_active: false })] }).file.ads;
  assert.equal(row.end_date, "2025-09-12T00:00:00.000Z");
});

test("an inactive ad without a valid end date stays unknown, never the collection time", () => {
  for (const endDate of [undefined, null, "1757635200", Number.NaN, 0, 1757635200000]) {
    const [row] = adapt({ items: [apifyItem({ is_active: false, end_date: endDate })] }).file.ads;
    assert.equal(row.end_date, null, `end_date ${String(endDate)}`);
    assert.equal(row.network_end_date_raw, null, `end_date ${String(endDate)}`);
    assert.notEqual(row.end_date, GENERATED_AT);
  }
  const [unknownState] = adapt({ items: [apifyItem({ is_active: undefined })] }).file.ads;
  assert.equal(unknownState.is_active, null);
  assert.equal(unknownState.end_date, null);
});

test("every sample ad is active, so none gets a canonical end date", () => {
  const items = new Map(sample().map((item) => [item.ad_archive_id, item]));
  for (const row of adapt().file.ads) {
    const item = items.get(row.ad_archive_id);
    assert.ok(item);
    assert.equal(row.is_active, true);
    assert.equal(row.end_date, null);
    assert.equal(row.start_date, new Date((item.start_date as number) * 1000).toISOString());
    assert.equal(row.network_end_date_raw, new Date((item.end_date as number) * 1000).toISOString());
  }
});

// --- Row routing -----------------------------------------------------------------

test("rows that cannot satisfy the contract go to unresolved_ads, and the file still validates", () => {
  const items = [
    apifyItem({ ad_archive_id: "900000000000010" }),
    apifyItem({ ad_archive_id: undefined }),
    apifyItem({ ad_archive_id: "   " }),
    apifyItem({ ad_archive_id: "900000000000011", page_id: undefined }),
    apifyItem({ ad_archive_id: "900000000000012", start_date: "1757548800" }),
    apifyItem({ ad_archive_id: "900000000000013", start_date: 1757548800000 }),
    apifyItem({ ad_archive_id: "900000000000014", start_date: undefined }),
  ];
  const { file, text } = adapt({ items });
  assert.deepEqual(file.ads.map((row) => row.ad_archive_id), ["900000000000010"]);
  assert.equal(file.unresolved_ads.length, 6);
  assert.deepEqual(file.quality_summary.unresolved_reasons, {
    missing_ad_archive_id: 2, missing_page_id: 1, invalid_start_date: 3,
  });

  const analysis = analyzeImport(assertsMethod(text));
  if (!analysis.ok) assert.fail(`${analysis.reason}: ${analysis.detail}`);
  assert.equal(analysis.counts.ads, 1);
  assert.equal(analysis.counts.quarantine, 6);
});

test("a repeated ad_archive_id is kept once and counted", () => {
  const { file } = adapt({ items: [apifyItem(), apifyItem(), apifyItem({ ad_archive_id: "900000000000002" })] });
  assert.equal(file.ads.length, 2);
  assert.equal(file.quality_summary.duplicates_removed, 1);
});

test("country comes from the collection request, not the provider's snapshot", () => {
  const { file } = adapt({ items: [apifyItem()] });
  assert.equal(file.scope.country, "TH");
  assert.doesNotMatch(JSON.stringify(file.ads), /country_iso_code|"US"/);
});

// --- Multi-value fields and creatives --------------------------------------------

test("publisher_platform and page_categories stay multi-value, as supplied", () => {
  const items = new Map(sample().map((item) => [item.ad_archive_id, item]));
  for (const row of adapt().file.ads) {
    const item = items.get(row.ad_archive_id);
    assert.ok(item);
    assert.deepEqual(row.publisher_platform, item.publisher_platform);
    assert.deepEqual(row.page_categories, (item.snapshot as Row).page_categories);
  }
});

test("IMAGE, VIDEO, MULTI_IMAGES and DPA keep their media, reduced to the allowlisted sub-keys", () => {
  const expectedKeys: Record<string, string[]> = {
    images: ["original_image_url", "resized_image_url"],
    videos: ["video_hd_url", "video_sd_url", "video_preview_image_url"],
    cards: [
      "title", "body", "caption", "cta_type", "cta_text", "link_url", "link_description",
      "original_image_url", "resized_image_url", "video_hd_url", "video_sd_url", "video_preview_image_url",
    ],
  };
  const { file } = adapt();
  const rows = new Map(file.ads.map((row) => [row.ad_archive_id, row]));
  const formats = new Set<unknown>();
  for (const item of sample()) {
    const row = rows.get(item.ad_archive_id);
    assert.ok(row);
    formats.add(row.display_format);
    for (const [name, keys] of Object.entries(expectedKeys)) {
      const source = (item.snapshot as Row)[name] as unknown[];
      const mapped = row[name] as Row[];
      assert.equal(mapped.length, source.length, `${String(item.ad_archive_id)} ${name}`);
      for (const entry of mapped) assert.deepEqual(Object.keys(entry), keys);
    }
  }
  assert.deepEqual([...formats].sort(), ["DPA", "IMAGE", "MULTI_IMAGES", "VIDEO"]);
  assert.ok(file.ads.filter((row) => row.display_format === "DPA").every((row) => (row.cards as Row[]).length === 6));
  assert.ok(file.ads.filter((row) => row.display_format === "MULTI_IMAGES").every((row) => (row.images as Row[]).length >= 4));
  assert.doesNotMatch(JSON.stringify(file.ads), /watermarked_|image_crops/);
});

// --- Compatibility with the unchanged import engine ------------------------------

test("analyzeImport reads the adapter's export with the same active-ad semantics and counts", () => {
  const analysis = analyzeImport(assertsMethod(adapt().text));
  if (!analysis.ok) assert.fail(`${analysis.reason}: ${analysis.detail}`);
  assert.equal(analysis.counts.ads, 59);
  assert.equal(analysis.counts.quarantine, 0);
  for (const key of ["sourceRows", "uniqueAds", "uniquePages", "unresolvedCount"] as const) {
    assert.equal(analysis.reported[key], analysis.computed[key], key);
  }
  assert.equal(analysis.scope.country, "TH");
  assert.equal(analysis.scope.collectedAt, GENERATED_AT);
  assert.ok(analysis.canonical.ads.every((ad) => ad.isActive === true && ad.endDate === null));
});

test("where both collectors saw the same ad, the canonical fields qualified in C01 agree", () => {
  const extension = analyzeImport(EXTENSION_TEXT);
  const apify = analyzeImport(assertsMethod(adapt().text));
  if (!extension.ok) assert.fail(`${extension.reason}: ${extension.detail}`);
  if (!apify.ok) assert.fail(`${apify.reason}: ${apify.detail}`);

  const byAd = <T extends { adArchiveId: string }>(rows: T[]) => new Map(rows.map((r) => [r.adArchiveId, r]));
  const byPage = <T extends { pageId: string }>(rows: T[]) => new Map(rows.map((r) => [r.pageId, r]));
  const [eAds, aAds] = [byAd(extension.canonical.ads), byAd(apify.canonical.ads)];
  const [eObs, aObs] = [byAd(extension.canonical.adObservations), byAd(apify.canonical.adObservations)];
  const [ePages, aPages] = [byPage(extension.canonical.pages), byPage(apify.canonical.pages)];

  const shared = [...eAds.keys()].filter((id) => aAds.has(id));
  assert.equal(shared.length, 27);
  const collation = { agree: 0, apifyMissing: 0 };
  const cta = { same: 0, localized: 0 };
  for (const id of shared) {
    const [e, a, eo, ao] = [eAds.get(id), aAds.get(id), eObs.get(id), aObs.get(id)];
    assert.ok(e && a && eo && ao);
    assert.equal(a.pageId, e.pageId, `${id} page_id`);
    assert.equal(aPages.get(a.pageId)?.pageProfileUri, ePages.get(e.pageId)?.pageProfileUri, `${id} page_profile_uri`);
    assert.equal(Date.parse(a.startDate), Date.parse(e.startDate), `${id} start_date`);
    assert.equal(a.collationId, e.collationId, `${id} collation_id`);
    assert.equal(a.displayFormat, e.displayFormat, `${id} display_format`);
    assert.deepEqual([...a.publisherPlatform].sort(), [...e.publisherPlatform].sort(), `${id} publisher_platform`);
    assert.equal(a.isActive, e.isActive, `${id} is_active`);
    assert.equal(ao.ctaType, eo.ctaType, `${id} cta_type`);
    assert.equal(ao.bodyText, eo.bodyText, `${id} body_text`);
    assert.equal(ao.title, eo.title, `${id} title`);
    if (ao.ctaText === eo.ctaText) cta.same += 1; else cta.localized += 1;
    if (ao.collationCount === null) collation.apifyMissing += 1;
    else {
      assert.equal(ao.collationCount, eo.collationCount, `${id} collation_count`);
      collation.agree += 1;
    }
  }
  assert.deepEqual(collation, { agree: 25, apifyMissing: 2 });
  // cta_text is the button label in the scraper's own locale ("Send message" against
  // "ส่งข้อความ"). cta_type — the field the product reasons about — agrees on all 27.
  assert.deepEqual(cta, { same: 1, localized: 26 });
});

// --- Limits and stop reasons -----------------------------------------------------

test("the record cap trims provider overshoot and reports limit_reached", () => {
  const { file } = adapt({ maxRecords: 50 });
  assert.equal(file.ads.length + file.unresolved_ads.length, 50);
  assert.equal(file.stop_reason, "limit_reached");
  assert.equal(file.quality_summary.provider_item_count, 59);
  assert.equal(adapt({ maxRecords: 59 }).file.stop_reason, "limit_reached");
  assert.equal(adapt({ maxRecords: 100 }).file.stop_reason, null);
});

test("source_exhausted needs all five conditions; SUCCEEDED alone is not enough", () => {
  const items = [apifyItem({ total: 2 }), apifyItem({ ad_archive_id: "900000000000002", total: 2 })];
  const allHold = { runSucceeded: true, ceilingReached: false, guardStopped: false, exhaustionEvidence: true };
  assert.equal(adapt({ items, maxRecords: 10, stop: allHold }).file.stop_reason, "source_exhausted");

  for (const broken of [
    { runSucceeded: false }, { ceilingReached: true }, { guardStopped: true }, { exhaustionEvidence: false },
  ]) {
    const stop = { ...allHold, ...broken };
    assert.equal(adapt({ items, maxRecords: 10, stop }).file.stop_reason, null, JSON.stringify(broken));
  }
  const behindTotal = items.map((item) => ({ ...item, total: 3 }));
  assert.equal(adapt({ items: behindTotal, maxRecords: 10, stop: allHold }).file.stop_reason, null);
  assert.equal(adapt({ items, maxRecords: 2, stop: allHold }).file.stop_reason, "limit_reached");
  assert.equal(adapt({ stop: allHold }).file.stop_reason, null, "the sample returned 59 of a reported 1,475");
});

test("an export that would pass the byte limit is refused before it exists", () => {
  const size = Buffer.byteLength(adapt().text, "utf8");
  assert.equal(adaptApifyItems(input({ maxExportBytes: size })).ok, true);
  for (const limit of [size - 1, 1_000]) {
    const result = adaptApifyItems(input({ maxExportBytes: limit }));
    assert.equal(result.ok ? "ok" : result.reason, "export_too_large", `limit ${limit}`);
  }
});

// --- The Ad Library URL ------------------------------------------------------------

test("the server-built Ad Library URL is the search the qualification sample ran", () => {
  const ran = new URL(String(sample()[0].url));
  const built = new URL(buildAdLibraryUrl({ country: "TH", query: QUERY, activeStatus: "active" }));
  assert.equal(built.origin + built.pathname, ran.origin + ran.pathname);
  assert.deepEqual([...built.searchParams].sort(), [...ran.searchParams].sort());
});

test("the URL builder refuses input it cannot represent", () => {
  assert.throws(() => buildAdLibraryUrl({ country: "th", query: QUERY, activeStatus: "active" }));
  assert.throws(() => buildAdLibraryUrl({ country: "THA", query: QUERY, activeStatus: "active" }));
  assert.throws(() => buildAdLibraryUrl({ country: "TH", query: "   ", activeStatus: "active" }));
  assert.throws(() => buildAdLibraryUrl({
    country: "TH", query: QUERY, activeStatus: "inactive" as unknown as "active",
  }));
});

// --- Fixture hygiene ---------------------------------------------------------------

test("the committed provider fixtures carry no signed media URLs", () => {
  for (const [name, content] of [["apify-sample-59.json", SAMPLE_TEXT], ["extension-overlap-apify.json", EXTENSION_TEXT]]) {
    assert.doesNotMatch(content, /[?&](oh|oe)=/, name);
    assert.doesNotMatch(content, /\.fbcdn\.net\/[^\s"]*\?/, name);
  }
});

test("the sample still carries the forbidden fields, so dropping them is really tested", () => {
  for (const item of sample()) {
    for (const key of FORBIDDEN_IN_SAMPLE) assert.ok(key in item, `${String(item.ad_archive_id)} lacks ${key}`);
  }
});

test("a quoted query is an exact-phrase search, as the Ad Library builds it", () => {
  const ran = new URL("https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=TH&is_targeted_country=false&media_type=all&q=%22natto%20prime%22&search_type=keyword_exact_phrase&sort_data[direction]=desc&sort_data[mode]=total_impressions");
  const built = new URL(buildAdLibraryUrl({ country: "TH", query: '"natto prime"', activeStatus: "all" }));
  assert.deepEqual([...built.searchParams].sort(), [...ran.searchParams].sort());
  assert.equal(new URL(buildAdLibraryUrl({ country: "TH", query: "kivari", activeStatus: "all" })).searchParams.get("search_type"), "keyword_unordered");
});
