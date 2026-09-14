import type { PoolClient } from "pg";
import { withTransaction } from "../db/privileged.ts";
import { scrubProviderMessage, type CollectionProvider } from "./provider.ts";

/**
 * Cost reconciliation (C10): what the provider says the run actually cost.
 *
 * Separate from everything else on purpose. A collection's result and a
 * collection's cost settle at different times and for different reasons, so
 * this has its own schedule (`cost_next_check_at`), its own claim, its own
 * bounded window — and it keeps running while the request waits for an admin,
 * and after the request has failed. A run that charged money charged it whether
 * or not PT Glory made anything of the result.
 *
 * Every provider operation here is a read. Nothing in this file can start a
 * run, and the only provider call it makes is `readRun`.
 *
 * The evidence it is built on (C01-B): at the terminal moment the provider
 * reported $0.0443, and later $0.0998 for the same run. A terminal status is
 * not a settled bill, and the first figure is not the final one.
 */

/**
 * How long a claimed cost tick is pushed out of reach of other workers.
 *
 * Not a policy: it is how long one bounded read is allowed to take before the
 * row becomes claimable again, so a worker that dies mid-read cannot strand the
 * reconciliation. The real schedule is written at the end of the tick.
 */
export const COST_CLAIM_SECONDS = 300;

/** Cost states an automatic tick may still act on. `final` and `unreported` are done. */
export const COST_OPEN_STATES = ["reserved", "provisional"] as const;

export type CostAction =
  | "not_due"
  | "not_configured"
  | "provider_unavailable"
  | "no_amount"
  | "not_terminal"
  | "no_window_anchor"
  | "observed"
  | "updated"
  | "unchanged"
  | "finalized"
  | "window_exhausted_provisional"
  | "window_exhausted_unreported";

export type CostOutcome = {
  requestId: string;
  action: CostAction;
  costStatus: string | null;
  /** Server-side only. Amounts are admin accounting evidence, never a user DTO. */
  detail?: string;
};

type CostRow = {
  id: string;
  requested_by: string;
  status: string;
  provider_run_id: string;
  cost_status: string;
  cost_reserved_usd: string | null;
  cost_provisional_usd: string | null;
  cost_provisional_observed_at: Date | string | null;
  cost_first_read_at: Date | string | null;
  started_at: Date | string | null;
  start_attempted_at: Date | string | null;
};

type CostSettings = { settleMinutes: number | null; windowHours: number | null };

/**
 * One bounded cost tick: claim, one GET, persist, release.
 *
 * Returns without waiting for anything. A provider's accounting may take an
 * hour to settle; that is what the schedule is for, not this function.
 */
export async function reconcileCost(
  requestId: string,
  deps: { provider: CollectionProvider; now?: Date },
): Promise<CostOutcome> {
  const now = deps.now ?? new Date();

  // 1. Claim by pushing the schedule out. The UPDATE is the lock: a second
  //    worker arriving at the same moment sees a check that is no longer due
  //    and gets nothing. No lifecycle lease is touched, so cost work never
  //    blocks the state machine.
  const claim = await withTransaction(async (client) => claimCostWork(client, requestId));
  if (!claim) return { requestId, action: "not_due", costStatus: null };
  const { request, settings } = claim;

  if (settings.settleMinutes === null || settings.windowHours === null) {
    return finish(request, { action: "not_configured", detail: "cost_settle_minutes or cost_final_window_hours is unset" });
  }

  // 2. The window is spent, so stop before spending a provider read on it.
  //
  //    The anchor is when the charge began: the provider's own start, or — when
  //    the provider never reported one — the instant this server committed to
  //    attempting the start. Nothing else. `created_at` would start the clock
  //    before a queued request had done anything, and any read-derived instant
  //    would let a failing provider extend its own deadline.
  //
  //    This is a polling deadline and nothing more. Billing-cycle attribution
  //    belongs to C05, which uses `started_at` alone and fails closed without it.
  const anchor = instant(request.started_at) ?? instant(request.start_attempted_at);
  if (anchor === null) {
    // An identified run with no usable anchor: the window cannot be evaluated,
    // and polling without a deadline is not the safe direction. No timestamp is
    // invented to make the arithmetic work.
    return stopAutomatic(request, "no_window_anchor",
      "no usable cost-window anchor: neither a provider start nor a recorded start attempt");
  }
  if (now.getTime() - anchor > settings.windowHours * 3_600_000) {
    return stopAutomatic(request, "window_exhausted",
      "the automatic cost reconciliation window is spent");
  }

  // 3. The one read.
  const read = await deps.provider.readRun(request.provider_run_id);
  if (!read.ok) {
    // Nothing is inferred from an unanswered question: no zero, no finality,
    // no change to the figure already held.
    return finish(request, {
      action: "provider_unavailable", nextMinutes: settings.settleMinutes,
      detail: `provider unavailable: ${read.detail}`,
    });
  }
  // Only a terminal run has a bill to agree with itself about. A RUNNING or
  // UNKNOWN status may carry a figure, and that figure is a number in flight:
  // it never finalizes, and it never becomes the agreement evidence either —
  // recording it would let a mid-run reading settle a cost.
  if (!read.value.terminal) {
    return finish(request, {
      action: "not_terminal", nextMinutes: settings.settleMinutes,
      detail: `provider run is ${read.value.status.toLowerCase()}, not terminal`,
    });
  }

  const amount = usdText(read.value.usage.reportedTotalUsd);
  if (amount === null) {
    // An accounting shape nobody can read is not evidence of a cost.
    return finish(request, {
      action: "no_amount", nextMinutes: settings.settleMinutes,
      detail: "the provider reported no usable amount",
    });
  }

  // 4. Compare with what is already held.
  const held = request.cost_provisional_usd;
  if (held === null) {
    return finish(request, {
      action: "observed", costStatus: "provisional", provisional: amount, observedAt: now,
      firstReadAt: now, nextMinutes: settings.settleMinutes, audit: "collection.cost_observed",
      detail: `first provider figure: ${amount}`,
    });
  }
  if (!sameAmount(held, amount)) {
    // C01-B: $0.0443 became $0.0998. A figure that moved restarts the clock —
    // the rule is two agreeing reads, not two reads.
    return finish(request, {
      action: "updated", costStatus: "provisional", provisional: amount, observedAt: now,
      nextMinutes: settings.settleMinutes, audit: "collection.cost_updated",
      detail: `provider figure moved ${held} → ${amount}`,
    });
  }

  // 5. The frozen rule: two reads at least `cost_settle_minutes` apart agree.
  const seenAt = instant(request.cost_provisional_observed_at);
  const settled = seenAt !== null && now.getTime() - seenAt >= settings.settleMinutes * 60_000;
  if (!settled) {
    // The same number read too soon is the same read, not a second one.
    return finish(request, {
      action: "unchanged", nextMinutes: settings.settleMinutes,
      detail: `unchanged at ${amount}, not yet ${settings.settleMinutes} minutes apart`,
    });
  }
  return finish(request, {
    action: "finalized", costStatus: "final", final: amount, finalizedAt: now,
    stopPolling: true, audit: "collection.cost_finalized",
    detail: `settled at ${amount}`,
  });
}

/**
 * Stops automatic cost reconciliation without inventing an amount.
 *
 * A figure already in hand stays provisional — a deadline is not agreement. A
 * request that never got one becomes `unreported`, which C05 still holds the
 * reservation for. An admin may reopen the window later (C11), read-only.
 */
async function stopAutomatic(
  request: CostRow,
  reason: "window_exhausted" | "no_window_anchor",
  detail: string,
): Promise<CostOutcome> {
  const hasFigure = request.cost_provisional_usd !== null;
  return finish(request, {
    action: reason === "no_window_anchor" ? "no_window_anchor"
      : hasFigure ? "window_exhausted_provisional" : "window_exhausted_unreported",
    stopPolling: true,
    ...(hasFigure ? {} : { costStatus: "unreported" as const }),
    audit: "collection.cost_window_exhausted",
    detail,
  });
}

/**
 * Claims one due cost reconciliation.
 *
 * Deliberately says nothing about the request's status or `requires_admin`: a
 * request that failed, or that is waiting for a person, still has a bill. The
 * conditions are only the ones that make a cost read meaningful — an identified
 * run, an open cost status, and a check that is due.
 */
async function claimCostWork(client: PoolClient, requestId: string) {
  const claimed = await client.query<CostRow>(
    `update public.collection_requests
        set cost_next_check_at = now() + make_interval(secs => $2),
            updated_at = now()
      where id = $1
        -- Never guess a run. With no identified run there is nothing to ask
        -- about, and asking about somebody else's run would be worse.
        and provider_run_id is not null
        and cost_status = any($3::text[])
        and cost_next_check_at is not null
        and cost_next_check_at <= now()
      returning id, requested_by, status, provider_run_id, cost_status, cost_reserved_usd,
                cost_provisional_usd, cost_provisional_observed_at, cost_first_read_at,
                started_at, start_attempted_at`,
    [requestId, COST_CLAIM_SECONDS, [...COST_OPEN_STATES]],
  );
  if (claimed.rowCount === 0) return null;
  const settings = await readCostSettings(client);
  return { request: claimed.rows[0], settings };
}

/**
 * Persists one tick.
 *
 * Earlier evidence is kept: `cost_first_read_at` is written once, and a
 * finalized figure does not erase the provisional one it settled from.
 */
async function finish(
  request: CostRow,
  write: {
    action: CostAction;
    costStatus?: string;
    provisional?: string;
    final?: string;
    observedAt?: Date;
    firstReadAt?: Date;
    finalizedAt?: Date;
    stopPolling?: boolean;
    nextMinutes?: number;
    audit?: string;
    detail?: string;
  },
): Promise<CostOutcome> {
  const detail = write.detail ? scrubProviderMessage(write.detail) : null;
  await withTransaction(async (client) => {
    await client.query(
      `update public.collection_requests
          set cost_status = coalesce($2, cost_status),
              cost_provisional_usd = coalesce($3, cost_provisional_usd),
              cost_provisional_observed_at = coalesce($4, cost_provisional_observed_at),
              -- Once: the first provider figure ever seen for this run.
              cost_first_read_at = coalesce(cost_first_read_at, $5),
              cost_final_usd = coalesce($6, cost_final_usd),
              cost_finalized_at = coalesce($7, cost_finalized_at),
              cost_next_check_at = case when $8 then null
                                        when $9::int is null then cost_next_check_at
                                        else now() + make_interval(mins => $9::int) end,
              updated_at = now()
        where id = $1`,
      [
        request.id,
        write.costStatus ?? null,
        write.provisional ?? null,
        write.observedAt?.toISOString() ?? null,
        write.firstReadAt?.toISOString() ?? null,
        write.final ?? null,
        write.finalizedAt?.toISOString() ?? null,
        write.stopPolling === true,
        write.nextMinutes ?? null,
      ],
    );
    if (write.audit) {
      // Amounts only, never a provider payload.
      await client.query(
        `insert into public.audit_logs (actor, action, entity_type, entity_id, after)
         values ($1, $2, 'collection_request', $3, $4::jsonb)`,
        [
          request.requested_by, write.audit, request.id,
          JSON.stringify({
            cost_status: write.costStatus ?? request.cost_status,
            ...(write.provisional ? { provisional_usd: write.provisional } : {}),
            ...(write.final ? { final_usd: write.final } : {}),
          }),
        ],
      );
    }
  });
  return {
    requestId: request.id,
    action: write.action,
    costStatus: write.costStatus ?? request.cost_status,
    ...(detail ? { detail } : {}),
  };
}

async function readCostSettings(client: PoolClient): Promise<CostSettings> {
  const { rows } = await client.query<{ key: string; value: unknown }>(
    "select key, value from public.app_settings where key in ('collector.cost_settle_minutes', 'collector.cost_final_window_hours')",
  );
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  const number = (key: string) => {
    const value = settings.get(key);
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  };
  return {
    settleMinutes: number("collector.cost_settle_minutes"),
    windowHours: number("collector.cost_final_window_hours"),
  };
}

/**
 * The provider's figure as exact decimal text, or null.
 *
 * Money is never parsed into a float here; the text is checked and carried
 * through to a numeric column. A shape nobody documented fails closed.
 */
function usdText(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return trimmed;
}

/** Decimal-text equality, so "0.0998" and "0.09980" are the same money. */
function sameAmount(a: string, b: string): boolean {
  const normalize = (value: string) => {
    const [whole, fraction = ""] = value.trim().split(".");
    return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.replace(/0+$/, "")}`;
  };
  return normalize(a) === normalize(b);
}

function instant(value: Date | string | null): number | null {
  if (value === null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
