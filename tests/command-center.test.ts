import test from "node:test";
import assert from "node:assert/strict";
import { isFalling, railOrder } from "../lib/owned-ads/command-center.ts";

test("falling needs a good previous week, a weak latest week and real spend in both", () => {
  assert.equal(isFalling({ spend: 1000, value: 2500 }, { spend: 1000, value: 2490 }), true);
  assert.equal(isFalling({ spend: 1000, value: 2490 }, { spend: 1000, value: 1000 }), false, "2.49 before was never good");
  assert.equal(isFalling({ spend: 1000, value: 3000 }, { spend: 1000, value: 2500 }), false, "exactly 2.5 now has not fallen");
  assert.equal(isFalling({ spend: 999, value: 5000 }, { spend: 1000, value: 100 }), false);
  assert.equal(isFalling({ spend: 1000, value: 5000 }, { spend: 999, value: 100 }), false);
  assert.equal(isFalling({ spend: 1000, value: null }, { spend: 1000, value: 100 }), false);
});

test("rail lists units by ad count with their falling counts", () => {
  const rail = railOrder(
    [{ id: "b", name: "U11", ads: 388 }, { id: null, name: "x", ads: 397 }, { id: "a", name: "U5", ads: 412 }, { id: "c", name: "U3", ads: 388 }],
    [{ unit_id: "b", count: 22 }, { unit_id: null, count: 5 }],
  );
  assert.deepEqual(rail.map(unit => unit.name), ["U5", "U11", "U3"]);
  assert.deepEqual(rail.map(unit => unit.falling), [0, 22, 0]);
});
