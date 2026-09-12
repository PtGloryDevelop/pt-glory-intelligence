/**
 * Collector budget arithmetic (C05). Pure: no database, no clock, no settings
 * reader — the caller passes the settings it read (C07) and the instant to
 * judge. Every figure here is exact; none of it is a price.
 *
 * The vocabulary matters, because three different numbers get called "cost":
 *
 *   finalized actual cost   the provider's settled figure for a run
 *   held reservation        what PT Glory holds aside for a request
 *   provisional cost        a provider figure that is still moving
 *
 * window commitment  = finalized actual cost + active held reservations
 * available budget   = configured budget − window commitment
 *
 * A commitment is not spend and not usage: most of it is money nobody has been
 * charged. Releasing an unresolved reservation lowers the held amount and
 * raises the available budget by the same figure; it changes no actual cost and
 * no provider evidence.
 *
 * Attribution, frozen by the owner:
 *   - the current window comes from the evaluation instant and the configured
 *     anchor and length;
 *   - an active held reservation carries across cycle boundaries until it is
 *     finalized or explicitly released — including a request failed as
 *     provider_start_unknown, whose run may still have charged;
 *   - a finalized actual cost belongs to the window containing the
 *     charge-bearing collection start, never the request's creation, its finish
 *     or the moment its cost settled;
 *   - a finalized cost with no start timestamp fails closed rather than falling
 *     back to another one.
 *
 * Money is integer micro-USD (1 USD = 1,000,000). The database column is
 * numeric(12,6), so six decimals is the smallest unit either side can express,
 * and no admission decision is ever taken on a float.
 */

export const MICROS_PER_USD = 1_000_000n;

/** Refusals the product already has wording for (spec §12, §15). */
export const REFUSALS = ["not_configured", "budget_reached", "busy"] as const;
export type Refusal = (typeof REFUSALS)[number];

/**
 * A request's states, split by whether it still occupies the collector.
 *
 * Non-terminal states hold a slot — including `provider_start_uncertain`, whose
 * run may be alive and charging, and `settling`, whose dataset is still being
 * read. Nothing here invents a state: the set is exactly the schema's CHECK
 * minus the two terminal values.
 */
export const CONCURRENCY_SLOT_STATES = [
  "queued", "starting", "provider_start_uncertain", "running", "settling", "importing",
] as const;
export const TERMINAL_STATES = ["succeeded", "failed"] as const;

export function consumesConcurrencySlot(status: string): boolean {
  return (CONCURRENCY_SLOT_STATES as readonly string[]).includes(status);
}

/** The accounting-relevant part of one request row, as the database stores it. */
export type RequestAccounting = {
  status: string;
  cost_status: "reserved" | "provisional" | "final" | "unreported";
  /** numeric(12,6) arrives from pg as a string; a JSON number is accepted too. */
  cost_reserved_usd: string | number | null;
  cost_provisional_usd: string | number | null;
  cost_final_usd: string | number | null;
  reservation_released_at: string | Date | null;
  /**
   * When the charge-bearing collection started. The only timestamp a finalized
   * actual cost may be attributed by; a settled cost without it is a data fault,
   * not something to attribute elsewhere.
   */
  started_at: string | Date | null;
};

export type CollectorSettings = {
  enabled: unknown;
  monthly_budget_usd: unknown;
  max_charge_per_run_usd: unknown;
  billing_cycle_anchor: unknown;
  billing_cycle_length_months: unknown;
};

export type BillingWindow = { start: Date; end: Date; index: number };

export type Commitment = {
  /** Settled provider cost whose collection started inside this window. */
  finalizedActualCostMicros: bigint;
  /** What is still held aside, wherever the request began. */
  heldReservationMicros: bigint;
  /** finalized actual cost + held reservations. Never called spend. */
  windowCommitmentMicros: bigint;
  counts: {
    /** Settled costs attributed to this window. */
    final: number;
    /** Reservations still held, carried across boundaries when older. */
    held: number;
    /** Releases seen: they hold nothing and carry nothing. */
    released: number;
    /** Settled costs that began in another window. */
    startedElsewhere: number;
  };
};

export type CommitmentResult =
  | { ok: true; commitment: Commitment }
  | { ok: false; reason: "unattributable_final_cost"; count: number };

export type BudgetAssessment =
  | {
      ok: true;
      window: BillingWindow;
      commitment: Commitment;
      availableBudgetMicros: bigint;
      /** min(configured per-run ceiling, available budget). Always > 0 here. */
      runCeilingMicros: bigint;
      slotsInUse: number;
    }
  | {
      ok: false;
      refusal: Refusal;
      /** Server-side only. The user-facing wording stays neutral. */
      detail: string;
      window?: BillingWindow;
      commitment?: Commitment;
      availableBudgetMicros?: bigint;
      slotsInUse?: number;
    };

// --- money ---------------------------------------------------------------------

/**
 * Exact USD → micro-USD. Parses the decimal text itself rather than multiplying
 * a float: `0.1 * 1e6` is 100000.00000000001, and a budget must not depend on
 * that. A JSON number goes through its own string form, which is exact for
 * every value either side can store.
 */
export function usdToMicros(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  // More than six decimals cannot be represented, and silently rounding money
  // is how a budget drifts. Refuse instead.
  if (fraction.length > 6) return null;
  const micros = BigInt(whole) * MICROS_PER_USD + BigInt((fraction + "000000").slice(0, 6));
  return sign === "-" ? -micros : micros;
}

/** micro-USD → the six-decimal text the database column holds. */
export function microsToUsd(micros: bigint): string {
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const whole = absolute / MICROS_PER_USD;
  const fraction = (absolute % MICROS_PER_USD).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

// --- the billing window --------------------------------------------------------

/**
 * PT Glory's own collector cycle runs on Bangkok calendar dates — the business's
 * clock, not the provider's billing timezone, which this file knows nothing
 * about. Bangkok is UTC+7 with no daylight saving, so one offset covers every
 * date.
 */
const BANGKOK_OFFSET_MINUTES = 7 * 60;

/**
 * The window containing `now`: `[anchor + k·L, anchor + (k+1)·L)`.
 *
 * The anchor is a Bangkok calendar date (`YYYY-MM-DD`) and the length is in
 * months, both configured. No calendar month is assumed anywhere: an anchor of
 * the 5th gives windows that begin on the 5th, and a 3-month length gives
 * quarters from that date.
 *
 * Day 31 is kept and clamped per window, so a 31st anchor lands on the 28th,
 * 29th or 30th where the month is shorter, and returns to the 31st afterwards.
 */
export function billingWindow(anchor: string, lengthMonths: number, now: Date): BillingWindow | null {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchor.trim());
  if (!parsed) return null;
  if (!Number.isInteger(lengthMonths) || lengthMonths < 1) return null;

  const [, y, m, d] = parsed;
  const anchorYear = Number(y);
  const anchorMonth = Number(m) - 1;
  const anchorDay = Number(d);
  if (anchorMonth > 11 || anchorDay < 1 || anchorDay > 31) return null;
  const start = boundary(anchorYear, anchorMonth, anchorDay, 0);
  if (now.getTime() < start.getTime()) return null;

  // Step in whole windows from an estimate, so a clamped boundary cannot make
  // the search drift: months elapsed divided by the length is never more than
  // one window out.
  const bangkokNow = shift(now, BANGKOK_OFFSET_MINUTES);
  const monthsApart = (bangkokNow.getUTCFullYear() - anchorYear) * 12
    + (bangkokNow.getUTCMonth() - anchorMonth);
  let index = Math.max(0, Math.floor(monthsApart / lengthMonths));
  while (boundary(anchorYear, anchorMonth, anchorDay, index * lengthMonths).getTime() > now.getTime()) index -= 1;
  while (boundary(anchorYear, anchorMonth, anchorDay, (index + 1) * lengthMonths).getTime() <= now.getTime()) index += 1;

  return {
    start: boundary(anchorYear, anchorMonth, anchorDay, index * lengthMonths),
    end: boundary(anchorYear, anchorMonth, anchorDay, (index + 1) * lengthMonths),
    index,
  };
}

/** The instant a window boundary falls on: Bangkok midnight, as UTC. */
function boundary(year: number, month: number, day: number, monthsAdded: number): Date {
  const total = month + monthsAdded;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return shift(new Date(Date.UTC(targetYear, targetMonth, clamped, 0, 0, 0, 0)), -BANGKOK_OFFSET_MINUTES);
}

function shift(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

// --- commitment ----------------------------------------------------------------

/**
 * What one request contributes, and never both halves at once.
 *
 * A settled figure replaces the reservation: the reservation remainder is not
 * counted again. A released reservation contributes nothing — which is not a
 * claim that the run cost nothing, only that PT Glory no longer holds money for
 * it.
 */
export function contributionOf(request: RequestAccounting): { actualMicros: bigint; heldMicros: bigint } {
  const reserved = usdToMicros(request.cost_reserved_usd) ?? 0n;
  const provisional = usdToMicros(request.cost_provisional_usd) ?? 0n;
  const final = usdToMicros(request.cost_final_usd);

  if (request.cost_status === "final") {
    // Settled. The held reservation is gone, whether the figure came in lower
    // or higher than it.
    return { actualMicros: final ?? 0n, heldMicros: 0n };
  }
  if (request.reservation_released_at !== null) return { actualMicros: 0n, heldMicros: 0n };
  if (request.cost_status === "provisional") {
    // A provider figure that is still moving does not replace the reservation;
    // the larger of the two is held. Provisional is never a finalized actual
    // cost, only a conservative hold.
    return { actualMicros: 0n, heldMicros: provisional > reserved ? provisional : reserved };
  }
  // reserved, or unreported with the reservation still held — including a
  // request failed as provider_start_unknown, whose run may have charged.
  return { actualMicros: 0n, heldMicros: reserved };
}

/**
 * The window's commitment.
 *
 * `requests` is every request that could still weigh on the budget: anything
 * holding a reservation, whichever cycle it began in, plus finalized ones whose
 * attribution is decided here from the charge-bearing start.
 */
export function windowCommitment(
  requests: readonly RequestAccounting[],
  window: BillingWindow,
): CommitmentResult {
  const counts = { final: 0, held: 0, released: 0, startedElsewhere: 0 };
  let finalizedActualCostMicros = 0n;
  let heldReservationMicros = 0n;
  let unattributable = 0;

  for (const request of requests) {
    const { actualMicros, heldMicros } = contributionOf(request);

    if (request.cost_status === "final") {
      const started = request.started_at === null ? Number.NaN : new Date(request.started_at).getTime();
      if (Number.isNaN(started)) {
        // Fail closed. Attributing a real charge by any other timestamp would
        // move money between cycles to make the arithmetic work.
        unattributable += 1;
        continue;
      }
      if (started < window.start.getTime() || started >= window.end.getTime()) {
        counts.startedElsewhere += 1;
        continue;
      }
      finalizedActualCostMicros += actualMicros;
      counts.final += 1;
      continue;
    }

    if (request.reservation_released_at !== null) {
      // Released: holds nothing, and carries nothing into this window either.
      counts.released += 1;
      continue;
    }

    // An active hold stays with the budget until it is finalized or released,
    // whichever cycle it was taken in.
    if (heldMicros > 0n) {
      heldReservationMicros += heldMicros;
      counts.held += 1;
    }
  }

  if (unattributable > 0) {
    return { ok: false, reason: "unattributable_final_cost", count: unattributable };
  }
  return {
    ok: true,
    commitment: {
      finalizedActualCostMicros,
      heldReservationMicros,
      windowCommitmentMicros: finalizedActualCostMicros + heldReservationMicros,
      counts,
    },
  };
}

export function availableBudgetMicros(configuredBudgetMicros: bigint, commitment: Commitment): bigint {
  return configuredBudgetMicros - commitment.windowCommitmentMicros;
}

/** min(configured per-run ceiling, available budget). Null when nothing is left. */
export function runCeilingMicros(perRunCeiling: bigint, available: bigint): bigint | null {
  const ceiling = perRunCeiling < available ? perRunCeiling : available;
  return ceiling > 0n ? ceiling : null;
}

// --- the whole judgement -------------------------------------------------------

/**
 * Everything admission needs, decided from settings and the requests that can
 * still weigh on the budget.
 *
 * Fails closed: a setting left unset is `not_configured`, never a default
 * invented here, and so is a settled cost nobody can attribute. No price appears
 * in this file, and the C01 qualification run teaches it nothing.
 *
 * What this is NOT: admission. Taking the advisory lock, counting live requests
 * inside it and inserting the queued row belong to C07; this only computes.
 */
export function assessBudget(input: {
  settings: CollectorSettings;
  /** Every request still holding a reservation, plus every finalized one. */
  requests: readonly RequestAccounting[];
  /** Every non-terminal request, whichever window it belongs to. */
  liveRequests: readonly { status: string }[];
  maxConcurrent: unknown;
  now: Date;
}): BudgetAssessment {
  const { settings } = input;

  if (settings.enabled !== true) {
    return { ok: false, refusal: "not_configured", detail: "collector_disabled" };
  }
  const budget = usdToMicros(asNumberish(settings.monthly_budget_usd));
  const perRun = usdToMicros(asNumberish(settings.max_charge_per_run_usd));
  const anchor = typeof settings.billing_cycle_anchor === "string" ? settings.billing_cycle_anchor : null;
  const length = typeof settings.billing_cycle_length_months === "number"
    ? settings.billing_cycle_length_months : null;
  const concurrency = typeof input.maxConcurrent === "number" ? input.maxConcurrent : null;

  const missing = [
    budget === null && "monthly_budget_usd",
    perRun === null && "max_charge_per_run_usd",
    anchor === null && "billing_cycle_anchor",
    length === null && "billing_cycle_length_months",
    concurrency === null && "max_concurrent",
  ].filter((name): name is string => typeof name === "string");
  if (missing.length > 0) {
    return { ok: false, refusal: "not_configured", detail: `unset: ${missing.join(", ")}` };
  }
  if (budget! < 0n || perRun! <= 0n || concurrency! < 1 || !Number.isInteger(concurrency!)) {
    return { ok: false, refusal: "not_configured", detail: "setting out of range" };
  }

  const window = billingWindow(anchor!, length!, input.now);
  if (!window) {
    return { ok: false, refusal: "not_configured", detail: "billing cycle does not resolve" };
  }

  const result = windowCommitment(input.requests, window);
  if (!result.ok) {
    return {
      ok: false, refusal: "not_configured",
      detail: `${result.reason}: ${result.count} settled cost(s) without a collection start`,
      window,
    };
  }
  const commitment = result.commitment;
  const available = availableBudgetMicros(budget!, commitment);
  const slotsInUse = input.liveRequests.filter((r) => consumesConcurrencySlot(r.status)).length;

  if (slotsInUse >= concurrency!) {
    return {
      ok: false, refusal: "busy", detail: `${slotsInUse} of ${concurrency} slots in use`,
      window, commitment, availableBudgetMicros: available, slotsInUse,
    };
  }

  const ceiling = runCeilingMicros(perRun!, available);
  if (ceiling === null) {
    return {
      ok: false, refusal: "budget_reached",
      detail: `available ${microsToUsd(available)} of ${microsToUsd(budget!)}`,
      window, commitment, availableBudgetMicros: available, slotsInUse,
    };
  }

  return {
    ok: true, window, commitment, availableBudgetMicros: available,
    runCeilingMicros: ceiling, slotsInUse,
  };
}

/** app_settings holds JSON, so a figure may arrive as a number or as text. */
function asNumberish(value: unknown): string | number | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}
