import { canonicalInstant } from "./provider.ts";

/**
 * The provider result settlement gate (C09, architecture review §9).
 *
 * A terminal provider run is not a complete result. C01-B measured it: about a
 * second after `finishedAt` the dataset metadata, the pagination total and the
 * charged events all said 117 items; the settled dataset held 133. Importing on
 * the strength of SUCCEEDED would have recorded 117 ads as a complete
 * collection, and nothing downstream would ever have said otherwise.
 *
 * So the dataset is observed twice, at least `result_settle_seconds` apart, and
 * only an unchanged pair is allowed to become an import. This module is the
 * pure half of that rule: no clock of its own, no I/O, no database. The state
 * machine supplies the observations and owns what is persisted.
 */

/** One reading of the provider's dataset. Diagnostics, never canonical counts. */
export type SettlementObservation = {
  itemCount: number;
  /** Canonical instant (C06), or null when the provider reports none. */
  modifiedAt: string | null;
  /** The pagination total from a one-item page read. */
  paginationTotal: number;
  /** Canonical instant this reading was taken at. */
  observedAt: string;
};

export type SettlementVerdict =
  /** Nothing to compare against yet: this reading becomes the baseline. */
  | { verdict: "first" }
  /** Taken too soon after the baseline to count as a second observation. */
  | { verdict: "too_soon"; detail: string }
  /** The result moved. The new reading becomes the baseline. */
  | { verdict: "changed"; detail: string }
  /** The provider's own numbers disagree with each other. */
  | { verdict: "inconsistent"; detail: string }
  /** Stable across two real observations, and internally consistent. */
  | { verdict: "ready" };

/**
 * Conditions 2, 3 and 4 of the readiness gate.
 *
 * Condition 1 (terminal success) is already true of any request in `settling`;
 * condition 5 (the full fetch returns exactly the settled count) is checked in
 * the import step, where the items are actually read; condition 6 is every
 * guard around this function.
 *
 * `chargedEventCounts` is deliberately absent. It is billing evidence, recorded
 * for admins, and it is never required to equal the item count — coupling result
 * readiness to billing semantics would make an unrelated provider accounting lag
 * look like an incomplete collection.
 */
export function assessSettlement(
  prior: SettlementObservation | null,
  current: SettlementObservation,
  settleSeconds: number,
): SettlementVerdict {
  if (current.paginationTotal !== current.itemCount) {
    return {
      verdict: "inconsistent",
      detail: `pagination total ${current.paginationTotal} disagrees with item count ${current.itemCount}`,
    };
  }
  if (!prior) return { verdict: "first" };

  // Two readings of the same moment are one observation. The interval is what
  // makes the second reading evidence rather than a repeat of the first.
  const elapsed = elapsedSeconds(prior.observedAt, current.observedAt);
  if (elapsed === null || elapsed < settleSeconds) {
    return { verdict: "too_soon", detail: `only ${elapsed ?? "an unreadable interval"} s since the last observation` };
  }

  if (prior.itemCount !== current.itemCount) {
    return { verdict: "changed", detail: `item count moved ${prior.itemCount} → ${current.itemCount}` };
  }
  if (prior.modifiedAt !== current.modifiedAt) {
    return { verdict: "changed", detail: "the dataset was modified between observations" };
  }
  return { verdict: "ready" };
}

/** How many items an import is allowed to ask for: the settled count under the request's own cap. */
export function intendedCount(itemCount: number, maxRecords: number): number {
  return Math.max(0, Math.min(itemCount, maxRecords));
}

/**
 * Whether the bounded settlement window has run out.
 *
 * Unknown inputs are not expiry: a missing start or an unset window keeps the
 * request settling rather than handing it to an admin on a guess.
 */
export function settlementExpired(
  startedAt: string | null,
  now: string,
  windowMinutes: number | null,
): boolean {
  if (startedAt === null || windowMinutes === null) return false;
  const elapsed = elapsedSeconds(startedAt, now);
  return elapsed !== null && elapsed > windowMinutes * 60;
}

function elapsedSeconds(from: string, to: string): number | null {
  const start = canonicalInstant(from);
  const end = canonicalInstant(to);
  if (start === null || end === null) return null;
  return (Date.parse(end) - Date.parse(start)) / 1000;
}
