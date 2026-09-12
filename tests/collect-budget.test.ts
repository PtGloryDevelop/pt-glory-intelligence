import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONCURRENCY_SLOT_STATES, MICROS_PER_USD, TERMINAL_STATES, assessBudget,
  availableBudgetMicros, billingWindow, consumesConcurrencySlot, contributionOf,
  microsToUsd, runCeilingMicros, usdToMicros, windowCommitment,
  type BillingWindow, type CollectorSettings, type Commitment, type RequestAccounting,
} from "../lib/collect/budget.ts";

/**
 * C05 — the collector's budget arithmetic.
 *
 * Three numbers that are not each other: the provider's settled cost, what PT
 * Glory holds aside, and a provider figure still moving. The commitment is the
 * first plus the second, and no request may contribute both its own halves.
 *
 * Attribution is the part worth reading twice. A held reservation stays with the
 * budget across cycle boundaries until it is finalized or released; a settled
 * cost belongs to the window its charge-bearing collection started in.
 */

const NOW = new Date("2026-09-20T00:00:00Z");
const WINDOW = billingWindow("2026-09-05", 1, NOW)!;
/** 2026-10-04T17:00Z — Bangkok midnight on the 5th. */
const BOUNDARY = WINDOW.end;
const started = "2026-09-10T00:00:00Z";

function request(overrides: Partial<RequestAccounting> = {}): RequestAccounting {
  return {
    status: "succeeded",
    cost_status: "reserved",
    cost_reserved_usd: "0.100000",
    cost_provisional_usd: null,
    cost_final_usd: null,
    reservation_released_at: null,
    started_at: started,
    ...overrides,
  };
}

/** Unwraps a commitment the test expects to be attributable. */
function commitmentOf(requests: RequestAccounting[], window: BillingWindow = WINDOW): Commitment {
  const result = windowCommitment(requests, window);
  if (!result.ok) assert.fail(`commitment refused: ${result.reason}`);
  return result.commitment;
}

const settings = (overrides: Partial<CollectorSettings> = {}): CollectorSettings => ({
  enabled: true,
  monthly_budget_usd: 10,
  max_charge_per_run_usd: 0.5,
  billing_cycle_anchor: "2026-09-05",
  billing_cycle_length_months: 1,
  ...overrides,
});

const assess = (requests: RequestAccounting[], overrides: Partial<CollectorSettings> = {}, extras: {
  maxConcurrent?: unknown; live?: { status: string }[]; now?: Date;
} = {}) => assessBudget({
  settings: settings(overrides),
  requests,
  liveRequests: extras.live ?? [],
  maxConcurrent: "maxConcurrent" in extras ? extras.maxConcurrent : 1,
  now: extras.now ?? NOW,
});

// --- money ----------------------------------------------------------------------

test("USD is parsed exactly, never through a float", () => {
  assert.equal(usdToMicros("0.100000"), 100_000n);
  assert.equal(usdToMicros("0.0998"), 99_800n);
  assert.equal(usdToMicros("0.000001"), 1n);
  assert.equal(usdToMicros(0.1), 100_000n);
  assert.equal(usdToMicros(0.3), 300_000n);
  assert.equal(usdToMicros("12"), 12n * MICROS_PER_USD);
  // The float trap this exists to avoid.
  assert.notEqual(Math.round(0.1 * 1_000_000), 100_000.0000001);
  assert.equal(usdToMicros("0.1")! + usdToMicros("0.2")!, usdToMicros("0.3"));
});

test("repeated addition of fractional cents stays exact", () => {
  let total = 0n;
  for (let i = 0; i < 10_000; i += 1) total += usdToMicros("0.000750")!;
  assert.equal(total, usdToMicros("7.5"));
  assert.equal(microsToUsd(total), "7.500000");
});

test("a figure finer than the column can hold is refused, not rounded", () => {
  assert.equal(usdToMicros("0.0000001"), null);
  assert.equal(usdToMicros("abc"), null);
  assert.equal(usdToMicros(Number.NaN), null);
  assert.equal(usdToMicros(Number.POSITIVE_INFINITY), null);
  assert.equal(usdToMicros(null), null);
});

test("micro-USD formats back to the column's six decimals", () => {
  assert.equal(microsToUsd(99_800n), "0.099800");
  assert.equal(microsToUsd(0n), "0.000000");
  assert.equal(microsToUsd(-1n), "-0.000001");
  assert.equal(microsToUsd(12n * MICROS_PER_USD), "12.000000");
});

// --- the billing window ---------------------------------------------------------

test("the window is the configured anchor and length, not a calendar month", () => {
  assert.equal(WINDOW.start.toISOString(), "2026-09-04T17:00:00.000Z");
  assert.equal(WINDOW.end.toISOString(), "2026-10-04T17:00:00.000Z");

  const quarterly = billingWindow("2026-01-15", 3, new Date("2026-05-01T00:00:00Z"))!;
  assert.equal(quarterly.start.toISOString(), "2026-04-14T17:00:00.000Z");
  assert.equal(quarterly.end.toISOString(), "2026-07-14T17:00:00.000Z");
  assert.equal(quarterly.index, 1);
});

test("a boundary instant belongs to the window it opens", () => {
  const before = billingWindow("2026-09-05", 1, new Date(BOUNDARY.getTime() - 1))!;
  const at = billingWindow("2026-09-05", 1, BOUNDARY)!;
  const after = billingWindow("2026-09-05", 1, new Date(BOUNDARY.getTime() + 1))!;
  assert.equal(before.end.getTime(), BOUNDARY.getTime());
  assert.equal(at.start.getTime(), BOUNDARY.getTime());
  assert.equal(after.start.getTime(), BOUNDARY.getTime());
  assert.equal(at.index, before.index + 1);
});

test("a 31st anchor is clamped per window and then returns to the 31st", () => {
  const expected = [
    ["2026-01-31T12:00:00Z", "2026-01-30T17:00:00.000Z"],
    ["2026-02-28T12:00:00Z", "2026-02-27T17:00:00.000Z"],
    ["2026-03-31T12:00:00Z", "2026-03-30T17:00:00.000Z"],
    ["2026-04-30T12:00:00Z", "2026-04-29T17:00:00.000Z"],
  ] as const;
  for (const [now, start] of expected) {
    assert.equal(billingWindow("2026-01-31", 1, new Date(now))!.start.toISOString(), start, now);
  }
  // February in a leap year keeps the 29th.
  assert.equal(
    billingWindow("2024-01-31", 1, new Date("2024-02-29T12:00:00Z"))!.start.toISOString(),
    "2024-02-28T17:00:00.000Z",
  );
});

test("the window crosses a year without special-casing it", () => {
  const window = billingWindow("2026-12-20", 1, new Date("2027-01-05T00:00:00Z"))!;
  assert.equal(window.start.toISOString(), "2026-12-19T17:00:00.000Z");
  assert.equal(window.end.toISOString(), "2027-01-19T17:00:00.000Z");
});

test("a Bangkok date that differs from the UTC date lands in the right window", () => {
  // 18:00Z is already the 5th in Bangkok: the new window has opened.
  assert.equal(
    billingWindow("2026-09-05", 1, new Date("2026-10-04T18:00:00Z"))!.start.toISOString(),
    "2026-10-04T17:00:00.000Z",
  );
  // An hour earlier is still the 4th there, so still the previous window.
  assert.equal(
    billingWindow("2026-09-05", 1, new Date("2026-10-04T16:00:00Z"))!.end.toISOString(),
    "2026-10-04T17:00:00.000Z",
  );
});

test("an unresolvable cycle is refused rather than guessed", () => {
  assert.equal(billingWindow("2026-9-5", 1, new Date()), null);
  assert.equal(billingWindow("2026-09-05", 0, new Date()), null);
  assert.equal(billingWindow("2026-09-05", 1.5, new Date()), null);
  // Before the anchor there is no window at all.
  assert.equal(billingWindow("2026-09-05", 1, new Date("2026-08-01T00:00:00Z")), null);
});

// --- commitment -----------------------------------------------------------------

test("no prior usage commits nothing", () => {
  const commitment = commitmentOf([]);
  assert.equal(commitment.windowCommitmentMicros, 0n);
  assert.equal(commitment.finalizedActualCostMicros, 0n);
  assert.equal(commitment.heldReservationMicros, 0n);
});

test("a settled request commits its actual cost and holds nothing", () => {
  const commitment = commitmentOf([request({
    cost_status: "final", cost_reserved_usd: "0.100000", cost_final_usd: "0.099800",
  })]);
  assert.equal(commitment.finalizedActualCostMicros, 99_800n);
  assert.equal(commitment.heldReservationMicros, 0n);
  assert.equal(commitment.windowCommitmentMicros, 99_800n);
});

test("a reservation commits the amount held, not a cost", () => {
  const commitment = commitmentOf([request(), request()]);
  assert.equal(commitment.finalizedActualCostMicros, 0n);
  assert.equal(commitment.heldReservationMicros, 200_000n);
});

test("final and held mix without either being lost", () => {
  const commitment = commitmentOf([
    request({ cost_status: "final", cost_final_usd: "0.099800" }),
    request({ cost_status: "reserved", cost_reserved_usd: "0.250000" }),
  ]);
  assert.equal(commitment.finalizedActualCostMicros, 99_800n);
  assert.equal(commitment.heldReservationMicros, 250_000n);
  assert.equal(commitment.windowCommitmentMicros, 349_800n);
  assert.deepEqual(commitment.counts, { final: 1, held: 1, released: 0, startedElsewhere: 0 });
});

test("a request never contributes both its final cost and its reservation", () => {
  for (const final of ["0.050000", "0.100000", "0.400000"]) {
    const { actualMicros, heldMicros } = contributionOf(request({
      cost_status: "final", cost_reserved_usd: "0.100000", cost_final_usd: final,
    }));
    assert.equal(heldMicros, 0n, `held must be zero once ${final} is settled`);
    assert.equal(actualMicros, usdToMicros(final));
  }
  // The whole sequence a request walks, one state at a time.
  const reserved = request({ cost_status: "reserved", cost_reserved_usd: "0.100000" });
  const provisional = { ...reserved, cost_status: "provisional" as const, cost_provisional_usd: "0.044300" };
  const settled = { ...provisional, cost_status: "final" as const, cost_final_usd: "0.099800" };
  assert.deepEqual(
    [reserved, provisional, settled].map((r) => commitmentOf([r]).windowCommitmentMicros),
    [100_000n, 100_000n, 99_800n],
  );
});

test("a provisional figure holds, and is never a finalized actual cost", () => {
  const held = contributionOf(request({
    cost_status: "provisional", cost_reserved_usd: "0.100000", cost_provisional_usd: "0.044300",
  }));
  assert.deepEqual(held, { actualMicros: 0n, heldMicros: 100_000n });
  // A provider figure above the reservation is the conservative one.
  const above = contributionOf(request({
    cost_status: "provisional", cost_reserved_usd: "0.100000", cost_provisional_usd: "0.150000",
  }));
  assert.deepEqual(above, { actualMicros: 0n, heldMicros: 150_000n });
  // Either way it lands in the held column, never the settled one.
  const commitment = commitmentOf([request({
    cost_status: "provisional", cost_provisional_usd: "0.150000",
  })]);
  assert.equal(commitment.finalizedActualCostMicros, 0n);
  assert.equal(commitment.heldReservationMicros, 150_000n);
});

test("an unreported request keeps holding its reservation", () => {
  const commitment = commitmentOf([request({
    status: "failed", cost_status: "unreported", cost_reserved_usd: "0.100000",
  })]);
  assert.equal(commitment.heldReservationMicros, 100_000n,
    "a failed PT Glory request does not release the money by itself");
  assert.equal(commitment.finalizedActualCostMicros, 0n, "and no cost is invented for it");
});

test("releasing a reservation frees the budget without inventing a cost", () => {
  const before = commitmentOf([request({ cost_status: "unreported" })]);
  const after = commitmentOf([request({
    cost_status: "unreported", reservation_released_at: "2026-09-12T00:00:00Z",
  })]);

  assert.equal(before.heldReservationMicros - after.heldReservationMicros, 100_000n);
  assert.equal(after.finalizedActualCostMicros, before.finalizedActualCostMicros,
    "the settled actual cost is untouched");
  assert.equal(
    availableBudgetMicros(10n * MICROS_PER_USD, after)
      - availableBudgetMicros(10n * MICROS_PER_USD, before),
    100_000n,
    "the available budget rises by exactly the amount released",
  );
});

// --- attribution across a cycle boundary ----------------------------------------

/** The window after WINDOW: the one a boundary-crossing request is judged in. */
const NEXT_WINDOW = billingWindow("2026-09-05", 1, new Date(BOUNDARY.getTime() + 3_600_000))!;

test("a collection that started after the boundary belongs to the new window", () => {
  const afterBoundary = request({
    cost_status: "final", cost_final_usd: "0.099800",
    started_at: new Date(BOUNDARY.getTime() + 60_000).toISOString(),
  });
  assert.equal(commitmentOf([afterBoundary], NEXT_WINDOW).finalizedActualCostMicros, 99_800n);
  // And not to the window it was queued in, whenever that was.
  const previous = commitmentOf([afterBoundary], WINDOW);
  assert.equal(previous.finalizedActualCostMicros, 0n);
  assert.equal(previous.counts.startedElsewhere, 1);
});

test("an active reservation carries across the boundary until it resolves", () => {
  const stillHeld = request({ cost_status: "reserved", started_at: null });
  const commitment = commitmentOf([stillHeld], NEXT_WINDOW);
  assert.equal(commitment.heldReservationMicros, 100_000n,
    "money held aside is held in whichever cycle the question is asked");
  assert.equal(commitment.counts.held, 1);
});

test("an unknown start keeps holding across the boundary", () => {
  const unknownStart = request({
    status: "failed", cost_status: "unreported", started_at: null,
  });
  for (const [name, window] of [["this window", WINDOW], ["the next", NEXT_WINDOW]] as const) {
    const commitment = commitmentOf([unknownStart], window);
    assert.equal(commitment.heldReservationMicros, 100_000n, name);
    assert.equal(commitment.finalizedActualCostMicros, 0n, name);
  }
});

test("a collection that started before the boundary stays in its own window, however late it settles", () => {
  // Started inside WINDOW, settled days into the next cycle.
  const lateSettlement = request({
    cost_status: "final", cost_final_usd: "0.099800",
    started_at: new Date(BOUNDARY.getTime() - 3_600_000).toISOString(),
  });
  assert.equal(commitmentOf([lateSettlement], WINDOW).finalizedActualCostMicros, 99_800n);
  const next = commitmentOf([lateSettlement], NEXT_WINDOW);
  assert.equal(next.finalizedActualCostMicros, 0n, "the new cycle does not inherit an old charge");
  assert.equal(next.counts.startedElsewhere, 1);
});

test("a released reservation carries nothing into the next window", () => {
  const released = request({
    cost_status: "unreported", reservation_released_at: "2026-09-12T00:00:00Z", started_at: null,
  });
  for (const window of [WINDOW, NEXT_WINDOW]) {
    const commitment = commitmentOf([released], window);
    assert.equal(commitment.heldReservationMicros, 0n);
    assert.equal(commitment.finalizedActualCostMicros, 0n, "and no cost is invented for it");
    assert.equal(commitment.counts.released, 1);
  }
});

test("a settled cost with no collection start fails closed", () => {
  const orphan = request({ cost_status: "final", cost_final_usd: "0.099800", started_at: null });
  const result = windowCommitment([orphan], WINDOW);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "unattributable_final_cost");
    assert.equal(result.count, 1);
  }
  // An unreadable timestamp is the same fault, not a reason to guess.
  const unreadable = windowCommitment(
    [request({ cost_status: "final", cost_final_usd: "0.099800", started_at: "not a date" })], WINDOW);
  assert.equal(unreadable.ok, false);

  // And it stops admission rather than under-counting the budget.
  const assessment = assess([orphan]);
  assert.equal(assessment.ok, false);
  if (!assessment.ok) {
    assert.equal(assessment.refusal, "not_configured");
    assert.match(assessment.detail, /unattributable_final_cost/);
  }
});

// --- ceiling and admission ------------------------------------------------------

test("the ceiling is the smaller of the per-run guardrail and what is left", () => {
  assert.equal(runCeilingMicros(500_000n, 10n * MICROS_PER_USD), 500_000n);
  assert.equal(runCeilingMicros(500_000n, 200_000n), 200_000n);
  assert.equal(runCeilingMicros(500_000n, 0n), null);
  assert.equal(runCeilingMicros(500_000n, -1n), null);
});

test("a budget with nothing spent admits a run at the configured ceiling", () => {
  const result = assess([]);
  assert.ok(result.ok);
  assert.equal(result.runCeilingMicros, 500_000n);
  assert.equal(result.availableBudgetMicros, 10n * MICROS_PER_USD);
  assert.equal(result.slotsInUse, 0);
});

test("remaining budget below the guardrail becomes the ceiling", () => {
  const result = assess([request({ cost_reserved_usd: "9.800000" })]);
  assert.ok(result.ok);
  assert.equal(result.runCeilingMicros, 200_000n);
});

test("the budget boundary is exact to the smallest unit", () => {
  // Exactly committed: nothing is left, so nothing may start.
  const exact = assess([request({ cost_reserved_usd: "10.000000" })]);
  assert.equal(exact.ok, false);
  if (!exact.ok) assert.equal(exact.refusal, "budget_reached");

  // One micro-USD left is still a run, at that ceiling.
  const sliver = assess([request({ cost_reserved_usd: "9.999999" })]);
  assert.ok(sliver.ok);
  assert.equal(sliver.runCeilingMicros, 1n);

  // One micro-USD over is refused.
  const over = assess([request({ cost_reserved_usd: "10.000001" })]);
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.availableBudgetMicros, -1n);
});

test("a disabled collector fails closed", () => {
  for (const enabled of [false, null, undefined, "true"]) {
    const result = assess([], { enabled });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.refusal, "not_configured");
      assert.equal(result.detail, "collector_disabled");
    }
  }
});

test("a setting left unset is refused, never defaulted", () => {
  for (const key of [
    "monthly_budget_usd", "max_charge_per_run_usd", "billing_cycle_anchor",
    "billing_cycle_length_months",
  ] as const) {
    const result = assess([], { [key]: null });
    assert.equal(result.ok, false, key);
    if (!result.ok) {
      assert.equal(result.refusal, "not_configured");
      assert.match(result.detail, new RegExp(key));
    }
  }
  const noConcurrency = assess([], {}, { maxConcurrent: null });
  assert.equal(noConcurrency.ok, false);
  if (!noConcurrency.ok) assert.match(noConcurrency.detail, /max_concurrent/);
});

test("a per-run guardrail of zero is a configuration error, not an open door", () => {
  const result = assess([], { max_charge_per_run_usd: 0 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal, "not_configured");
});

test("the concurrency limit is read from the setting, never assumed", () => {
  const live = [{ status: "running" }];
  const atOne = assess([], {}, { maxConcurrent: 1, live });
  assert.equal(atOne.ok, false);
  if (!atOne.ok) {
    assert.equal(atOne.refusal, "busy");
    assert.equal(atOne.slotsInUse, 1);
  }
  const atTwo = assess([], {}, { maxConcurrent: 2, live });
  assert.ok(atTwo.ok);
  assert.equal(atTwo.slotsInUse, 1);
});

test("every non-terminal state holds a slot, and the terminal ones do not", () => {
  assert.deepEqual([...CONCURRENCY_SLOT_STATES], [
    "queued", "starting", "provider_start_uncertain", "running", "settling", "importing",
  ]);
  for (const status of CONCURRENCY_SLOT_STATES) assert.equal(consumesConcurrencySlot(status), true, status);
  for (const status of TERMINAL_STATES) assert.equal(consumesConcurrencySlot(status), false, status);
  assert.equal(consumesConcurrencySlot("reconciling"), false, "an invented state holds nothing");

  const live = CONCURRENCY_SLOT_STATES.map((status) => ({ status }));
  const busy = assess([], {}, { maxConcurrent: 6, live });
  assert.equal(busy.ok, false, "six non-terminal requests fill six slots");
  if (!busy.ok) assert.equal(busy.slotsInUse, 6);
});

test("budget is judged before the run, so a refusal precedes any provider start", () => {
  const spent = assess([request({ cost_status: "final", cost_final_usd: "10.000000" })]);
  assert.equal(spent.ok, false);
  if (!spent.ok) {
    assert.equal(spent.refusal, "budget_reached");
    assert.match(spent.detail, /available 0\.000000 of 10\.000000/);
  }
});

test("no price and no C01 figure is baked into the arithmetic", () => {
  const source = readFileSync("lib/collect/budget.ts", "utf8");
  for (const price of ["0.00075", "0.0998", "0.75", "0.0443", "2.25", "1475"]) {
    assert.ok(!source.includes(price), `${price} must not appear in the arithmetic`);
  }
  // And no attribution by any timestamp other than the collection start.
  assert.ok(!source.includes("created_at"), "created_at must not decide attribution");
  assert.ok(!source.includes("finished_at"), "finished_at must not decide attribution");
  assert.ok(!source.includes("cost_finalized_at"), "cost_finalized_at must not decide attribution");
});
