import test from "node:test";
import assert from "node:assert/strict";
import { pageList } from "../lib/read/request.ts";

test("a page list is 1-60 numeric ids, deduplicated; anything else is refused", () => {
  assert.deepEqual(pageList(null), { ok: true, value: null });
  assert.deepEqual(pageList("123,456,123"), { ok: true, value: ["123", "456"] });
  assert.deepEqual(pageList(" 123 , 456 "), { ok: true, value: ["123", "456"] });
  for (const bad of ["", ",", "12a", "123,abc", "1".repeat(33), Array.from({ length: 61 }, (_, i) => String(i + 1)).join(",")]) {
    assert.equal(pageList(bad).ok, false, bad.slice(0, 20));
  }
});
