import assert from "node:assert/strict";
import test from "node:test";
import { toggleComparison } from "../lib/explorer/comparison.ts";

test("creative comparison keeps observations, caps at four, and allows removal and replacement", () => {
  const ads = Array.from({ length: 5 }, (_, index) => ({ ad_archive_id: String(index), body_text: `copy ${index}` }));
  let selected: typeof ads = [];
  for (const ad of ads) selected = toggleComparison(selected, ad);
  assert.deepEqual(selected, ads.slice(0, 4));
  const original = selected;
  selected = toggleComparison(selected, { ...ads[1], body_text: "different observation" });
  assert.deepEqual(selected, [ads[0], ads[2], ads[3]]);
  assert.equal(original.length, 4);
  selected = toggleComparison(selected, ads[4]);
  assert.deepEqual(selected, [ads[0], ads[2], ads[3], ads[4]]);
  assert.deepEqual(toggleComparison([ads[0]], ads[0]), []);
});
