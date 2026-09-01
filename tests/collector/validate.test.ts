import assert from "node:assert/strict";
import test from "node:test";
import { validate, validateRaw } from "../../lib/collector/validate.ts";
import { GOLDEN_EXPECTED, goldenExport, goldenText, syntheticAd, syntheticExport } from "../fixtures/load.ts";

const reasonOf = (result: ReturnType<typeof validate>) => (result.ok ? "ok" : result.reason);

test("the real 500-ad export validates", () => {
  const result = validateRaw(goldenText());
  assert.equal(reasonOf(result), "ok");
  if (!result.ok) return;
  assert.equal(result.computed.sourceRows, GOLDEN_EXPECTED.sourceRows);
  assert.equal(result.computed.uniqueAds, GOLDEN_EXPECTED.uniqueAds);
  assert.equal(result.computed.uniquePages, GOLDEN_EXPECTED.uniquePages);
  assert.equal(result.computed.unresolvedCount, GOLDEN_EXPECTED.unresolvedCount);
});

test("malformed JSON is rejected", () => {
  assert.equal(reasonOf(validateRaw("{ not json")), "malformed_json");
});

test("a non-object export is rejected", () => {
  assert.equal(reasonOf(validate([])), "schema_mismatch");
  assert.equal(reasonOf(validate("nope")), "schema_mismatch");
});

test("each required file field is required", () => {
  for (const key of ["schema_version", "generated_at", "source", "ads", "unresolved_ads"]) {
    const file = syntheticExport();
    delete file[key];
    assert.equal(reasonOf(validate(file)), "schema_mismatch", `${key} must be required`);
  }
});

test("an unknown file field fails closed", () => {
  assert.equal(reasonOf(validate(syntheticExport({ surprise_totals: 1 }))), "unknown_field");
});

test("an unknown source or scope field fails closed", () => {
  const badSource = syntheticExport();
  (badSource.source as Record<string, unknown>).new_flag = true;
  assert.equal(reasonOf(validate(badSource)), "unknown_field");

  const badScope = syntheticExport();
  (badScope.scope as Record<string, unknown>).region = "TH-65";
  assert.equal(reasonOf(validate(badScope)), "unknown_field");
});

test("an unknown ad-row field fails closed", () => {
  const file = syntheticExport({}, [syntheticAd({ engagement_score: 42 })]);
  const result = validate(file);
  assert.equal(reasonOf(result), "unknown_field");
  if (!result.ok) assert.match(result.detail, /engagement_score/);
});

test("collection_method outside the enum is rejected", () => {
  const file = syntheticExport();
  (file.source as Record<string, unknown>).collection_method = "screenshot_ocr";
  assert.equal(reasonOf(validate(file)), "unsupported_collection_method");
});

test("every approved collection method is accepted", () => {
  for (const method of [
    "network_response_observation", "user_initiated_dom_observation", "socialapis_api",
  ]) {
    const file = syntheticExport();
    (file.source as Record<string, unknown>).collection_method = method;
    assert.equal(reasonOf(validate(file)), "ok", `${method} should be accepted`);
  }
});

test("more than 5,000 records is rejected", () => {
  const rows = Array.from({ length: 5_001 }, (_, i) =>
    syntheticAd({ ad_archive_id: `1${String(i).padStart(14, "0")}` }));
  assert.equal(reasonOf(validate(syntheticExport({}, rows))), "size_limit_exceeded");
});

test("exactly 5,000 records is still accepted", () => {
  const rows = Array.from({ length: 5_000 }, (_, i) =>
    syntheticAd({ ad_archive_id: `1${String(i).padStart(14, "0")}` }));
  assert.equal(reasonOf(validate(syntheticExport({}, rows))), "ok");
});

test("more than 25 MB is rejected before parsing", () => {
  const oversized = `{"padding":"${"x".repeat(26 * 1024 * 1024)}"}`;
  assert.equal(reasonOf(validateRaw(oversized)), "size_limit_exceeded");
});

test("a row that will become an ad must have page_id and start_date", () => {
  for (const key of ["page_id", "start_date"]) {
    const row = syntheticAd();
    row[key] = null;
    assert.equal(reasonOf(validate(syntheticExport({}, [row]))), "schema_mismatch", key);
  }
});

test("a missing ad_archive_id is a row-level issue, not a file rejection", () => {
  // T12 quarantines the row and commits the rest as partial, so validation
  // must let the file through.
  for (const missing of [null, undefined, ""]) {
    const row = syntheticAd({ ad_archive_id: missing });
    const file = syntheticExport({ source_rows: 1, unique_ads: 0, unresolved_count: 1 }, [row]);
    assert.equal(reasonOf(validate(file)), "ok", `ad_archive_id=${String(missing)}`);
  }
});

test("a present but malformed ad_archive_id is still a schema problem", () => {
  for (const bad of ["   ", { id: 1 }, ["x"], true]) {
    const file = syntheticExport({ unique_ads: 1 }, [syntheticAd({ ad_archive_id: bad })]);
    assert.equal(reasonOf(validate(file)), "schema_mismatch", JSON.stringify(bad));
  }
});

test("a quarantine-bound row is exempt from the other required fields", () => {
  const row = syntheticAd({ ad_archive_id: null, page_id: null, start_date: null });
  const file = syntheticExport({ source_rows: 1, unique_ads: 0, unique_pages: 0, unresolved_count: 1 }, [row]);
  assert.equal(reasonOf(validate(file)), "ok");
});

test("optional fields may be null or empty", () => {
  const row = syntheticAd({
    title: null, caption: null, link_url: null, link_description: null,
    collation_id: null, cta_type: null, cta_text: null,
    images: [], videos: [], cards: [], page_categories: [],
    page_like_count: null, is_active: null, display_format: null,
  });
  assert.equal(reasonOf(validate(syntheticExport({}, [row]))), "ok");
});

test("a reported count that disagrees with the computed one is rejected", () => {
  const file = syntheticExport({ unique_ads: 99 });
  const result = validate(file);
  assert.equal(reasonOf(result), "count_mismatch");
  if (!result.ok) assert.match(result.detail, /reported 99 \/ computed 1/);
});

test("mutating the golden export in memory does not touch the file on disk", () => {
  const copy = goldenExport();
  (copy.ads as unknown[]).length = 1;
  assert.equal((goldenExport().ads as unknown[]).length, 500);
});
