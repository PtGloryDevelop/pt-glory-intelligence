import assert from "node:assert/strict";
import test from "node:test";
import { computeCounts, diffCounts, readReportedCounts } from "../../lib/collector/counts.ts";
import { GOLDEN_EXPECTED, goldenExport, syntheticAd } from "../fixtures/load.ts";

test("computed counts match the pinned 500-ad export", () => {
  const file = goldenExport();
  assert.deepEqual(computeCounts(file as never), GOLDEN_EXPECTED);
});

test("reported counts match computed ones on the real export", () => {
  const file = goldenExport();
  assert.deepEqual(diffCounts(readReportedCounts(file), computeCounts(file as never)), []);
});

test("unique_pages counts across ads AND unresolved_ads", () => {
  // The collector builds its page set from every row, not just resolved ads.
  // Counting `ads` alone would under-report and reject a valid export.
  const file = {
    ads: [syntheticAd({ page_id: "p1" })],
    unresolved_ads: [{ page_id: "p2" }],
  };
  assert.equal(computeCounts(file as never).uniquePages, 2);
});

test("source_rows spans both arrays", () => {
  const file = { ads: [syntheticAd(), syntheticAd()], unresolved_ads: [{}, {}, {}] };
  assert.equal(computeCounts(file as never).sourceRows, 5);
});

test("unique_ads deduplicates repeated ad_archive_id", () => {
  const file = {
    ads: [syntheticAd({ ad_archive_id: "a" }), syntheticAd({ ad_archive_id: "a" })],
    unresolved_ads: [],
  };
  assert.equal(computeCounts(file as never).uniqueAds, 1);
  assert.equal(computeCounts(file as never).sourceRows, 2);
});

test("rows without ad_archive_id are unresolved, not ads", () => {
  const file = { ads: [syntheticAd()], unresolved_ads: [{ page_id: "p" }, { page_id: "p" }] };
  const counts = computeCounts(file as never);
  assert.equal(counts.uniqueAds, 1);
  assert.equal(counts.unresolvedCount, 2);
});

test("emptiness follows the collector's Boolean() rule", () => {
  // "" and 0 are falsy for the collector, so they count as absent here too.
  const file = {
    ads: [],
    unresolved_ads: [{ ad_archive_id: "", page_id: "" }, { ad_archive_id: 0, page_id: null }],
  };
  const counts = computeCounts(file as never);
  assert.equal(counts.unresolvedCount, 2);
  assert.equal(counts.uniqueAds, 0);
  assert.equal(counts.uniquePages, 0);
});

test("missing arrays are treated as empty", () => {
  assert.deepEqual(computeCounts({} as never), {
    sourceRows: 0, uniqueAds: 0, uniquePages: 0, unresolvedCount: 0,
  });
});

test("a count the collector omitted is not a mismatch", () => {
  const computed = { sourceRows: 3, uniqueAds: 2, uniquePages: 1, unresolvedCount: 1 };
  assert.deepEqual(diffCounts({}, computed), []);
  assert.deepEqual(diffCounts({ uniqueAds: 2 }, computed), []);
});

test("every disagreeing field is reported, not just the first", () => {
  const computed = { sourceRows: 3, uniqueAds: 2, uniquePages: 1, unresolvedCount: 1 };
  const mismatches = diffCounts(
    { sourceRows: 4, uniqueAds: 2, uniquePages: 9, unresolvedCount: 1 },
    computed,
  );
  assert.deepEqual(mismatches.map((m) => m.field), ["sourceRows", "uniquePages"]);
});
