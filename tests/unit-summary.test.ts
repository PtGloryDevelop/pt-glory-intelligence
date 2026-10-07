import assert from "node:assert/strict";
import test from "node:test";
import { combineUnits } from "../lib/owned-ads/performance.ts";

const row = (spend: number | null, conversations: number | null, purchase_value: number | null) => ({ spend, conversations, purchase_value });

test("all-units line sums groups and derives ratios from the sums", () => {
  assert.deepEqual(combineUnits([row(100, 4, 300), row(300, 4, 500)]),
    { spend: 400, conversations: 8, purchase_value: 800, roas: 2, cost_per_conversation: 50 });
  assert.equal(combineUnits([]), null);
});

test("one unknown group makes the sum and its ratios unknown", () => {
  const all = combineUnits([row(100, null, 300), row(300, 4, null)])!;
  assert.equal(all.spend, 400);
  assert.equal(all.conversations, null);
  assert.equal(all.roas, null);
  assert.equal(all.cost_per_conversation, null);
});
