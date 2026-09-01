import assert from "node:assert/strict";
import test from "node:test";
import { normalize } from "../../lib/collector/normalize.ts";
import { validate } from "../../lib/collector/validate.ts";
import { FORBIDDEN_KEYS } from "../../lib/collector/contract.ts";
import { GOLDEN_EXPECTED, goldenExport, syntheticAd, syntheticExport } from "../fixtures/load.ts";

function normalizedGolden() {
  const result = validate(goldenExport());
  assert.ok(result.ok, "golden fixture must validate");
  return normalize(result.file);
}

test("the real export normalizes to the expected shape", () => {
  const output = normalizedGolden();
  assert.equal(output.ads.length, GOLDEN_EXPECTED.uniqueAds);
  assert.equal(output.adObservations.length, GOLDEN_EXPECTED.uniqueAds);
  assert.equal(output.pages.length, GOLDEN_EXPECTED.uniquePages);
  assert.equal(output.pageObservations.length, GOLDEN_EXPECTED.uniquePages);
  assert.equal(output.quarantine.length, 0);
});

test("run provenance keeps reported and computed counts apart", () => {
  const { run } = normalizedGolden();
  assert.deepEqual(run.computed, GOLDEN_EXPECTED);
  assert.equal(run.reported.uniqueAds, GOLDEN_EXPECTED.uniqueAds);
  assert.equal(run.collectionMethod, "network_response_observation");
  assert.equal(run.collectedAt, "2026-08-28T09:57:53.687Z");
  assert.ok(run.reported.qualitySummary, "collector quality summary is kept as provenance");
});

test("collector-only fields never reach canonical data", () => {
  const output = normalizedGolden();
  const serialized = JSON.stringify({
    ads: output.ads, pages: output.pages,
    pageObservations: output.pageObservations,
    observations: output.adObservations.map((o) => ({ ...o, provenance: undefined })),
  });
  for (const dropped of ["meta_page_id", "page_aliases", "raw_evidence", "end_date_raw"]) {
    assert.doesNotMatch(serialized, new RegExp(dropped), `${dropped} must be dropped`);
  }
});

test("page identity keeps profile numeric id separate from page id", () => {
  const output = normalizedGolden();
  const withNumeric = output.pages.filter((page) => page.pageProfileNumericId);
  assert.ok(withNumeric.length > 0, "the real export has numeric profile ids");
  for (const page of withNumeric) {
    assert.notEqual(page.pageProfileNumericId, page.pageId);
  }
});

test("active ads carry a null end date and keep the raw value in provenance", () => {
  const output = normalizedGolden();
  const active = output.ads.filter((ad) => ad.isActive === true);
  assert.equal(active.length, GOLDEN_EXPECTED.uniqueAds, "every ad in this export is active");
  assert.ok(active.every((ad) => ad.endDate === null));
  const withRaw = output.adObservations.filter((o) => o.provenance.networkEndDateRaw);
  assert.equal(withRaw.length, GOLDEN_EXPECTED.uniqueAds, "raw upstream date is preserved");
});

test("multi-value fields stay arrays", () => {
  const output = normalizedGolden();
  const platforms = new Set(output.adObservations.flatMap((o) => o.publisherPlatform));
  assert.ok(platforms.size > 1);
  assert.ok(output.pageObservations.every((o) => Array.isArray(o.pageCategories)));
});

test("is_active null survives as unknown, not false", () => {
  const file = syntheticExport({}, [syntheticAd({ is_active: null })]);
  const result = validate(file);
  assert.ok(result.ok);
  const output = normalize(result.file);
  assert.equal(output.ads[0].isActive, null);
  assert.equal(output.adObservations[0].isActive, null);
});

test("unresolved rows are quarantined and never become ads", () => {
  const file = syntheticExport({}, [syntheticAd()], [{ page_id: "p9" }, { page_id: "p9" }]);
  const result = validate(file);
  assert.ok(result.ok);
  const output = normalize(result.file);
  assert.equal(output.ads.length, 1);
  assert.equal(output.quarantine.length, 2);
  assert.ok(output.quarantine.every((row) => row.reason === "unresolved_source_record"));
});

test("a resolved row without ad_archive_id is quarantined by the normalizer too", () => {
  // The validator rejects this file first; calling the normalizer directly
  // proves the second layer holds on its own.
  const output = normalize({
    schema_version: "v", generated_at: "2026-08-28T00:00:00.000Z",
    source: { collection_method: "network_response_observation" },
    ads: [syntheticAd({ ad_archive_id: null })], unresolved_ads: [],
  } as never);
  assert.equal(output.ads.length, 0);
  assert.deepEqual(output.quarantine.map((r) => r.reason), ["missing_ad_archive_id"]);
});

test("forbidden metrics never appear in canonical output, even bypassing the validator", () => {
  const poisoned = syntheticAd();
  for (const key of FORBIDDEN_KEYS) poisoned[key] = 999;
  const output = normalize({
    schema_version: "v", generated_at: "2026-08-28T00:00:00.000Z",
    source: { collection_method: "network_response_observation" },
    ads: [poisoned], unresolved_ads: [],
  } as never);

  const serialized = JSON.stringify(output.ads.concat() as unknown)
    + JSON.stringify(output.adObservations)
    + JSON.stringify(output.pages)
    + JSON.stringify(output.pageObservations);
  for (const key of FORBIDDEN_KEYS) {
    assert.doesNotMatch(serialized, new RegExp(`"${key}"`), `${key} leaked into canonical output`);
  }
});

test("forbidden metrics hidden inside collector metadata are stripped", () => {
  const row = syntheticAd();
  row._pt_glory = { source_level: "network", spend: 1234, roas: 9 };
  const output = normalize({
    schema_version: "v", generated_at: "2026-08-28T00:00:00.000Z",
    source: { collection_method: "network_response_observation" },
    ads: [row], unresolved_ads: [],
  } as never);
  const meta = output.adObservations[0].provenance.collectorMeta ?? {};
  assert.equal(meta.source_level, "network");
  assert.equal("spend" in meta, false);
  assert.equal("roas" in meta, false);
});

test("the validator rejects forbidden metrics before the normalizer sees them", () => {
  const result = validate(syntheticExport({}, [syntheticAd({ spend: 100 })]));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "unknown_field");
    assert.match(result.detail, /forbidden metric: spend/);
  }
});

test("500 real ads plus one row with no ad_archive_id commits as partial", () => {
  // The T06/T12 reconciliation, end to end: the file validates, counts include
  // the extra row, and only the bad row is quarantined.
  const file = goldenExport();
  const ads = file.ads as Record<string, unknown>[];
  ads.push({ ...structuredClone(ads[0]), ad_archive_id: null, record_key: null });
  file.source_rows = 501;
  file.unresolved_count = 1;

  const result = validate(file);
  assert.equal(result.ok, true, result.ok ? "" : `${result.reason}: ${result.detail}`);
  if (!result.ok) return;

  assert.equal(result.computed.sourceRows, 501);
  assert.equal(result.computed.uniqueAds, 500);
  assert.equal(result.computed.unresolvedCount, 1);

  const output = normalize(result.file);
  assert.equal(output.ads.length, 500, "the bad row must not become an ad");
  assert.equal(output.adObservations.length, 500);
  assert.equal(output.quarantine.length, 1);
  assert.equal(output.quarantine[0].reason, "missing_ad_archive_id");
});

test("normalize() refuses a row that skipped validation", () => {
  // page_id is guaranteed by the validator for every row carrying an
  // ad_archive_id. Neither quarantine reason describes its absence, so the
  // normalizer fails loudly rather than filing it under the wrong label.
  assert.throws(
    () => normalize({
      schema_version: "v", generated_at: "2026-08-28T00:00:00.000Z",
      source: { collection_method: "network_response_observation" },
      ads: [syntheticAd({ page_id: null })], unresolved_ads: [],
    } as never),
    /without page_id; run validate\(\) first/,
  );
});

test("normalizing the golden export twice gives identical output", () => {
  assert.deepEqual(normalizedGolden(), normalizedGolden());
});
