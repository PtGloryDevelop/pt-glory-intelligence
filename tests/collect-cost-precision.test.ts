import assert from "node:assert/strict";
import test from "node:test";
import { usdText } from "../lib/collect/cost.ts";

test("provider costs use the numeric(12,6) storage precision before agreement", () => {
  assert.equal(usdText("0.021050000000000003"), "0.021050");
  assert.equal(usdText("0.021050"), "0.021050");
  assert.equal(usdText("0.0210505"), "0.021051");
  assert.equal(usdText("999999.9999994"), "999999.999999");
  assert.equal(usdText("999999.9999995"), null);
  for (const input of [null, "-1", "NaN", "1e-7", ""]) assert.equal(usdText(input), null);
});
