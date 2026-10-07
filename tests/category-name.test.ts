import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CATEGORY_NAME, categoryName } from "../lib/categories/name.ts";

test("category names are trimmed, collapsed and bounded", () => {
  assert.deepEqual(categoryName("  ครีม   ผิวขาว "), { ok: true, value: "ครีม ผิวขาว" });
  for (const bad of [undefined, null, 42, "", "   "]) assert.equal(categoryName(bad).ok, false);
  assert.equal(categoryName("ก".repeat(MAX_CATEGORY_NAME)).ok, true);
  assert.equal(categoryName("ก".repeat(MAX_CATEGORY_NAME + 1)).ok, false);
});
