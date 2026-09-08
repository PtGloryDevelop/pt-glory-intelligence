import assert from "node:assert/strict";
import test from "node:test";
import {
  CATEGORY_BASIS, CATEGORY_PAGE_SORTS, DEFAULT_CATEGORY_SORT,
  categorySortKey, datasetComparability, observedShare,
} from "../lib/categories/workspace.ts";

/**
 * The category workspace's rules, tested away from the database.
 *
 * The one that matters most is the wording around a page's slice of a category:
 * the denominator is what PT Glory happened to observe, and calling that a
 * market share would be the single most damaging untruth this product could
 * tell.
 */

test("a page's slice is a share of what we observed, and says so", () => {
  const share = observedShare(42, 500);
  assert.equal(share.percent, 8.4);
  // The pair travels with the percentage, always.
  assert.equal(share.pair, "42 / 500");
  assert.match(share.label, /Ads ที่เราพบ/);
});

test("the share label never claims a market", () => {
  const forbidden = /market share|share of voice|spend|ส่วนแบ่งตลาด|ครองตลาด/i;
  assert.ok(!forbidden.test(observedShare(1, 2).label));
  assert.ok(!forbidden.test(CATEGORY_BASIS));
});

test("no denominator means no percentage, not a division by zero", () => {
  const share = observedShare(0, 0);
  assert.equal(share.percent, 0);
  assert.equal(share.pair, "0 / 0");
});

test("the category basis states it is not one snapshot of a market", () => {
  assert.match(CATEGORY_BASIS, /หลายรอบเก็บ/);
  assert.match(CATEGORY_BASIS, /ไม่ใช่ snapshot/);
  // ...and that the numbers are ours, not the market's.
  assert.match(CATEGORY_BASIS, /ไม่ใช่ทั้งตลาด/);
});

test("ranking sorts are an allowlist and name no unsupported metric", () => {
  assert.equal(categorySortKey(undefined), DEFAULT_CATEGORY_SORT);
  assert.equal(categorySortKey("evergreen"), "evergreen");
  // Refused, not silently defaulted: a shared research URL that quietly
  // reorders itself is worse than one that says it is wrong.
  assert.equal(categorySortKey("observed_ads; drop table ads"), null);
  assert.equal(categorySortKey("spend"), null);

  const forbidden = /spend|reach|impression|engagement|ctr|cpc|cpa|roas|conversion|winning|top|best|ผู้นำ|ตลาด/i;
  for (const option of CATEGORY_PAGE_SORTS) {
    assert.ok(!forbidden.test(option.key), `sort ${option.key} names an unsupported metric`);
    assert.ok(!forbidden.test(option.label), `label ${option.label} names an unsupported metric`);
  }
});

test("recently found and started recently are separate ranking dimensions", () => {
  const keys = CATEGORY_PAGE_SORTS.map((option) => option.key);
  assert.ok(keys.includes("recently_found"));
  assert.ok(keys.includes("started_recently"));
  const recent = CATEGORY_PAGE_SORTS.find((option) => option.key === "recently_found")!;
  const started = CATEGORY_PAGE_SORTS.find((option) => option.key === "started_recently")!;
  // Two clocks, two labels. Merging them would make one of the two facts
  // unreachable from the ranking.
  assert.notEqual(recent.label, started.label);
});

/* ------------------------------------------------------------ comparability */

test("datasets collected the same way are comparable", () => {
  const result = datasetComparability([
    { scope_query: "วิตามิน", scope_country: "TH" },
    { scope_query: "วิตามิน", scope_country: "TH" },
  ]);
  assert.equal(result.comparable, true);
  assert.equal(result.note, null);
});

test("datasets that asked different questions are flagged, not normalized", () => {
  const result = datasetComparability([
    { scope_query: "วิตามิน", scope_country: "TH" },
    { scope_query: "คอลลาเจน", scope_country: "TH" },
  ]);
  assert.equal(result.comparable, false);
  assert.match(result.note!, /คำค้น/);
  // The caveat names the collection as the possible cause, and refuses to
  // attribute the difference to the pages or the market.
  assert.match(result.note!, /ขอบเขตการเก็บ/);
  assert.match(result.note!, /ไม่ใช่ความต่างของเพจหรือของตลาด/);
});

test("a missing collection scope is its own value, not a match", () => {
  assert.equal(
    datasetComparability([
      { scope_query: null, scope_country: "TH" },
      { scope_query: "วิตามิน", scope_country: "TH" },
    ]).comparable,
    false,
  );
  // One dataset is trivially comparable with itself.
  assert.equal(datasetComparability([{ scope_query: null, scope_country: null }]).comparable, true);
});

test("an empty category is comparable rather than broken", () => {
  const result = datasetComparability([]);
  assert.equal(result.comparable, true);
  assert.equal(result.note, null);
});
