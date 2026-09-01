import assert from "node:assert/strict";
import test from "node:test";
import { computeCoverage, coverageOf, isPresent, tierFor } from "../../lib/collector/coverage.ts";
import { normalize } from "../../lib/collector/normalize.ts";
import { validate } from "../../lib/collector/validate.ts";
import { goldenExport } from "../fixtures/load.ts";

test("a read value is present even when it is falsy", () => {
  // is_active = false is a state the collector read. page_like_count = 0 is a
  // real count. Treating either as missing would under-report coverage and let
  // a known value be reported as unknown.
  assert.equal(isPresent(false), true, "false is known data");
  assert.equal(isPresent(0), true, "0 is known data");
  assert.equal(isPresent("0"), true);
  assert.equal(isPresent(-1), true);
  assert.equal(isPresent(true), true);
});

test("nothing-there values are absent", () => {
  assert.equal(isPresent(null), false);
  assert.equal(isPresent(undefined), false);
  assert.equal(isPresent(""), false);
  assert.equal(isPresent("   "), false, "whitespace-only is blank");
  assert.equal(isPresent("\n\t "), false);
  assert.equal(isPresent([]), false);
  assert.equal(isPresent({}), false);
});

test("an object of only nulls is absent", () => {
  // The previous collector shipped impressions_with_index as
  // {impressions_text: null, impressions_index: -1} on every row. A plain null
  // check called that 100% covered.
  assert.equal(isPresent({ impressions_text: null, impressions_index: null }), false);
  assert.equal(isPresent({ impressions_text: null, impressions_index: -1 }), true);
  assert.equal(isPresent({ a: undefined }), false);
});

test("array presence recurses into its elements", () => {
  // The array-shaped version of the null-object problem: a list that only
  // contains empty things is not coverage.
  assert.equal(isPresent([null]), false);
  assert.equal(isPresent([{}]), false);
  assert.equal(isPresent([{}, {}]), false);
  assert.equal(isPresent([{ url: null }]), false);
  assert.equal(isPresent([""]), false);
  assert.equal(isPresent([[]]), false);

  assert.equal(isPresent([{ url: "https://example.test/a.jpg" }]), true);
  assert.equal(isPresent([null, { url: "x" }]), true, "one real element is enough");
  assert.equal(isPresent(["x"]), true);
  assert.equal(isPresent([0]), true, "a list containing 0 holds a read value");
  assert.equal(isPresent([false]), true);
});

test("tier thresholds follow the 80/50 rule", () => {
  assert.equal(tierFor(1), "normal");
  assert.equal(tierFor(0.8), "normal");
  assert.equal(tierFor(0.79), "partial");
  assert.equal(tierFor(0.5), "partial");
  assert.equal(tierFor(0.49), "low");
  assert.equal(tierFor(0), "low");
});

test("coverage always carries its denominator", () => {
  const result = coverageOf("title", ["a", null, "", "b"]);
  assert.deepEqual(result, {
    field: "title", presentCount: 2, totalCount: 4, coverage: 0.5, tier: "partial",
  });
});

test("an empty dataset reports zero coverage without dividing by zero", () => {
  const result = coverageOf("title", []);
  assert.equal(result.coverage, 0);
  assert.equal(result.totalCount, 0);
  assert.equal(result.tier, "low");
});

test("coverage of the real 500-ad export matches the measured baseline", () => {
  const parsed = validate(goldenExport());
  assert.ok(parsed.ok);
  const rows = computeCoverage(normalize(parsed.file));
  const byField = new Map(rows.map((row) => [row.field, row]));

  // Percentages measured directly from the pinned export.
  const expected: Record<string, { present: number; tier: string }> = {
    ad_archive_id: { present: 500, tier: "normal" },
    page_id: { present: 500, tier: "normal" },
    page_name: { present: 500, tier: "normal" },
    page_like_count: { present: 500, tier: "normal" },
    page_categories: { present: 500, tier: "normal" },
    start_date: { present: 500, tier: "normal" },
    display_format: { present: 500, tier: "normal" },
    publisher_platform: { present: 500, tier: "normal" },
    is_active: { present: 500, tier: "normal" },
    collation_count: { present: 500, tier: "normal" },
    body_text: { present: 498, tier: "normal" },
    cta_type: { present: 463, tier: "normal" },
    cta_text: { present: 463, tier: "normal" },
    videos: { present: 261, tier: "partial" },
    images: { present: 223, tier: "low" },
    title: { present: 180, tier: "low" },
    link_url: { present: 45, tier: "low" },
    caption: { present: 41, tier: "low" },
    link_description: { present: 21, tier: "low" },
    cards: { present: 17, tier: "low" },
  };

  for (const [field, want] of Object.entries(expected)) {
    const row = byField.get(field);
    assert.ok(row, `missing coverage for ${field}`);
    assert.equal(row.totalCount, 500, `${field} denominator`);
    assert.equal(row.presentCount, want.present, `${field} present count`);
    assert.equal(row.tier, want.tier, `${field} tier`);
  }
});

test("every measured field reports counts, coverage and tier together", () => {
  const parsed = validate(goldenExport());
  assert.ok(parsed.ok);
  for (const row of computeCoverage(normalize(parsed.file))) {
    assert.equal(typeof row.presentCount, "number");
    assert.equal(typeof row.totalCount, "number");
    assert.equal(row.coverage, row.totalCount === 0 ? 0 : row.presentCount / row.totalCount);
    assert.ok(["normal", "partial", "low"].includes(row.tier));
  }
});

test("fields below half coverage are flagged low", () => {
  const parsed = validate(goldenExport());
  assert.ok(parsed.ok);
  const low = computeCoverage(normalize(parsed.file))
    .filter((row) => row.tier === "low")
    .map((row) => row.field)
    .sort();
  assert.deepEqual(low, ["caption", "cards", "images", "link_description", "link_url", "title"]);
});
