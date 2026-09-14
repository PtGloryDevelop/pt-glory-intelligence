import assert from "node:assert/strict";
import test from "node:test";
import {
  assessSettlement, intendedCount, settlementExpired, type SettlementObservation,
} from "../lib/collect/settlement.ts";

/**
 * C09 — the settlement rule, on its own.
 *
 * No database, no provider: this is the arithmetic that decides whether a
 * provider dataset has stopped moving. The case it exists for is C01-B, where a
 * dataset reported 117 items about a second after the run finished and held 133
 * once it settled.
 */

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 11, 9, 0, seconds)).toISOString();

const observation = (overrides: Partial<SettlementObservation> = {}): SettlementObservation => ({
  itemCount: 133,
  modifiedAt: "2026-09-11T09:09:30.000Z",
  paginationTotal: 133,
  observedAt: at(0),
  ...overrides,
});

test("one reading is never a settlement", () => {
  assert.deepEqual(assessSettlement(null, observation(), 30), { verdict: "first" });
});

test("two readings of the same moment are one observation", () => {
  const prior = observation({ observedAt: at(0) });
  const current = observation({ observedAt: at(5) });
  const verdict = assessSettlement(prior, current, 30);
  assert.equal(verdict.verdict, "too_soon", "read again immediately, and nothing has been observed twice");
});

test("an unchanged pair, far enough apart, is ready", () => {
  const prior = observation({ observedAt: at(0) });
  const current = observation({ observedAt: at(30) });
  assert.deepEqual(assessSettlement(prior, current, 30), { verdict: "ready" });
});

test("the C01-B sequence: 117 then 133 is not a settled result", () => {
  const first = observation({ itemCount: 117, paginationTotal: 117, observedAt: at(0) });
  const second = observation({ itemCount: 133, paginationTotal: 133, observedAt: at(30) });
  const moved = assessSettlement(first, second, 30);
  assert.equal(moved.verdict, "changed");
  assert.match(moved.verdict === "changed" ? moved.detail : "", /117 → 133/);

  // Only a pair that agrees, taken far enough apart, settles it.
  const third = observation({ itemCount: 133, paginationTotal: 133, observedAt: at(60) });
  assert.deepEqual(assessSettlement(second, third, 30), { verdict: "ready" });
});

test("a dataset modified between observations is still moving", () => {
  const prior = observation({ modifiedAt: "2026-09-11T09:09:30.000Z", observedAt: at(0) });
  const current = observation({ modifiedAt: "2026-09-11T09:09:41.000Z", observedAt: at(30) });
  const verdict = assessSettlement(prior, current, 30);
  assert.equal(verdict.verdict, "changed");
});

test("a pagination total that disagrees with the item count is never ready", () => {
  const prior = observation({ observedAt: at(0) });
  const current = observation({ paginationTotal: 130, observedAt: at(30) });
  const verdict = assessSettlement(prior, current, 30);
  assert.equal(verdict.verdict, "inconsistent");
  assert.match(verdict.verdict === "inconsistent" ? verdict.detail : "", /130.*133/);
});

test("an unreadable observation interval is treated as too soon, never as ready", () => {
  const prior = observation({ observedAt: "not a time" });
  const verdict = assessSettlement(prior, observation({ observedAt: at(600) }), 30);
  assert.equal(verdict.verdict, "too_soon");
});

test("the intended range is the settled count under the request's own cap", () => {
  assert.equal(intendedCount(133, 300), 133);
  assert.equal(intendedCount(5_000, 300), 300, "the cap the request was admitted with wins");
  assert.equal(intendedCount(0, 300), 0);
  assert.equal(intendedCount(-1, 300), 0, "a nonsense count never becomes a negative range");
});

test("the settlement window expires only on evidence", () => {
  const start = at(0);
  assert.equal(settlementExpired(start, at(60), 1), false, "exactly at the window is not past it");
  assert.equal(settlementExpired(start, at(61), 1), true);
  assert.equal(settlementExpired(null, at(6_000), 1), false, "no start recorded is not an expiry");
  assert.equal(settlementExpired(start, at(6_000), null), false, "an unset window never expires");
  assert.equal(settlementExpired("whenever", at(6_000), 1), false, "an unreadable start is not an expiry");
});
