import type { PoolClient } from "pg";
import { withTransaction } from "../db/privileged.ts";
import { CONCURRENCY_SLOT_STATES } from "./budget.ts";
import { adaptApifyItems, stopReason } from "./adapter.ts";
import {
  assessSettlement, intendedCount, settlementExpired, type SettlementObservation,
} from "./settlement.ts";
import { analyzeImport } from "../import/analyze.ts";
import { commitImport } from "../import/commit.ts";
import { enqueueRun } from "../media/archive.ts";
import {
  canonicalInstant, scrubProviderMessage,
  type CollectionProvider, type ProviderRun,
} from "./provider.ts";
import { findCommittedRun as findCommittedRunWithClient } from "./adoption.ts";
import { findOriginalStart, identityConflict } from "./reconcile.ts";

export { RECONCILE_SKEW_SECONDS } from "./reconcile.ts";
export { identityConflict } from "./reconcile.ts";

/**
 * The collection state machine (C08): claim, one transition, persist, release.
 *
 * `advance(id)` is the only orchestration path. One call does a bounded amount
 * of work and returns; a later tick calls it again. Nothing here waits for a
 * run to finish, so correctness never depends on a function staying alive.
 *
 * The one rule everything else serves: a request gets **at most one automatic
 * provider start, ever**. The marker is committed before the call, so a lost
 * response leaves evidence that a start was attempted; that request becomes
 * `provider_start_uncertain` and is only ever reconciled by reading, never by
 * starting again.
 *
 * C09 continues the same machine through `settling` and `importing`: a terminal
 * provider run is observed twice before anything is imported, the canonical
 * commit is exactly-once by database constraint, and the media enqueue is a
 * separate step that can be retried without repeating the commit.
 *
 * What this file still does NOT do: cost reconciliation (C10), admin recovery
 * (C11) and the scheduler (C12).
 */

/** Back-off for the next bounded check. Engineering parameters, not prices. */
export const FIRST_CHECK_SECONDS = 20;
export const MAX_CHECK_SECONDS = 300;

/**
 * Run memory for a start.
 *
 * C04 seeds no setting for this, so it is a named constant here rather than an
 * invented app_settings row. It is an engineering parameter — the provider
 * charges a start event per gigabyte — and it belongs in settings the day an
 * admin needs to change it.
 */
export const RUN_MEMORY_MBYTES = 512;

/**
 * How many dataset items are read per provider page.
 *
 * An engineering parameter, like the back-off: the record cap is at most 4,970,
 * so the whole intended range is a handful of bounded reads inside one advance.
 */
export const ITEM_PAGE_SIZE = 1_000;

export type AdvanceAction =
  | "not_claimed"
  | "not_configured"
  | "start_attempted"
  | "started"
  | "start_refused"
  | "start_uncertain"
  | "reconciled"
  | "reconcile_unresolved"
  | "reconcile_ambiguous"
  | "still_running"
  | "provider_succeeded"
  | "provider_failed"
  | "identity_conflict"
  // C09: the settlement gate, the import and the one step after it.
  | "result_observed"
  | "result_ready"
  | "result_unsettled"
  | "import_incomplete"
  | "import_failed"
  | "imported"
  | "import_adopted"
  | "zero_result"
  | "media_enqueued"
  | "media_enqueue_retry";

export type AdvanceOutcome = {
  requestId: string;
  action: AdvanceAction;
  from: string | null;
  to: string | null;
  /** Server-side only. Never rendered to a normal user. */
  detail?: string;
};

type RequestRow = {
  id: string;
  status: string;
  requested_by: string;
  params: { max_records?: number } & Record<string, unknown>;
  source_url: string | null;
  provider_run_id: string | null;
  provider_dataset_id: string | null;
  provider_actor_build: string | null;
  started_at: string | null;
  cost_reserved_usd: string | null;
  start_attempted_at: string | null;
  attempt: number;
  // C09: what the settlement gate and the import step read.
  category_id: string;
  dataset_name: string | null;
  ceiling_reached: boolean;
  collection_run_id: string | null;
  import_attempted_at: string | null;
  media_enqueued_at: string | null;
  result_item_count: number | null;
  result_modified_at: string | null;
  result_pagination_total: number | null;
  result_observed_at: string | null;
  result_settle_started_at: string | null;
  result_settle_reopened_at: string | null;
};

type Settings = {
  actorBuild: string | null;
  runTimeoutMinutes: number | null;
  leaseSeconds: number;
  reconcileWindowMinutes: number | null;
  reconcilePageSize: number | null;
  /** C09. All three are unset in C04 and fail closed until an admin sets them. */
  resultSettleSeconds: number | null;
  resultSettleWindowMinutes: number | null;
  maxExportBytes: number | null;
};

/**
 * States a claim may take. `queued` is the only one whose transition performs
 * the single paid start, so a caller that must never start a run (a poll from a
 * progress page) claims from the second list instead. The exclusion is in the
 * claim's own SQL: nothing decides it by reading the row first and acting later.
 */
const CLAIMABLE = [
  "queued", "starting", "provider_start_uncertain", "running", "settling", "importing",
];
const CLAIMABLE_WITHOUT_START = CLAIMABLE.filter((status) => status !== "queued");

export async function advance(
  requestId: string,
  deps: { provider: CollectionProvider; now?: Date; worker?: string; allowStart?: boolean },
): Promise<AdvanceOutcome> {
  const worker = deps.worker ?? `worker-${process.pid}`;
  // Default true: the scheduler and the user's own POST may start a run.
  const allowStart = deps.allowStart !== false;

  // 1. Claim. One worker at a time, decided by the database.
  const claim = await withTransaction(async (client) => claimRequest(client, requestId, worker, allowStart));
  if (!claim) return { requestId, action: "not_claimed", from: null, to: null };
  const { request, settings, markedForStart } = claim;

  // 2. One transition, outside the claim transaction: a provider call must
  //    never hold a row lock, and the start marker is already committed.
  if (markedForStart) return startOnce(requestId, request, settings, deps.provider);
  if (request.status === "provider_start_uncertain") {
    return reconcile(requestId, request, settings, deps.provider);
  }
  if (request.status === "running") return pollRun(requestId, request, deps.provider);
  const now = deps.now ?? new Date();
  if (request.status === "settling") return settle(requestId, request, settings, deps.provider, now);
  if (request.status === "importing") return importResult(requestId, request, settings, deps.provider, now);
  // Committed, but the one step after the commit is still owed.
  if (request.status === "succeeded") return enqueueMedia(requestId, request);

  // A `starting` row whose worker died is resolved inside the claim itself.
  return { requestId, action: claim.claimAction, from: request.status, to: claim.claimedTo };
}

/**
 * Claim and, where the state calls for it, commit the marker in the same
 * transaction. `starting` with no run id means a worker died mid-start: that is
 * uncertain, and it is never restarted.
 */
async function claimRequest(
  client: PoolClient,
  requestId: string,
  worker: string,
  allowStart: boolean,
) {
  const settings = await readSettings(client);
  const claimed = await client.query<RequestRow>(
    `update public.collection_requests
        set lease_owner = $2,
            lease_expires_at = now() + make_interval(secs => $3),
            attempt = attempt + 1,
            updated_at = now()
      where id = $1
        and (
          -- C09 owns settling and importing. The queued state is absent from
          -- this list when the caller is not allowed to start a run.
          status = any($4::text[])
          -- Finished, with the one post-commit step still owed. The canonical
          -- import is done; only the media enqueue is retried here.
          or (status = 'succeeded' and media_enqueued_at is null)
        )
        -- A request waiting for a person is never picked up again automatically.
        -- That is what stops settlement polling after the window expires. It
        -- stops THIS work only: cost reconciliation (C10) has its own schedule
        -- in cost_next_check_at and its own read-only claim, and must not be
        -- built on this predicate.
        and requires_admin = false
        and (lease_expires_at is null or lease_expires_at < now())
        and (next_check_at is null or next_check_at <= now())
      returning id, status, requested_by, params, source_url, provider_run_id,
                provider_dataset_id, provider_actor_build, started_at,
                cost_reserved_usd, start_attempted_at, attempt,
                category_id, dataset_name, ceiling_reached, collection_run_id,
                import_attempted_at, media_enqueued_at, result_item_count,
                result_modified_at, result_pagination_total, result_observed_at,
                result_settle_started_at, result_settle_reopened_at`,
    [requestId, worker, settings.leaseSeconds, allowStart ? CLAIMABLE : CLAIMABLE_WITHOUT_START],
  );
  if (claimed.rowCount === 0) return null;
  const request = claimed.rows[0];

  if (request.status === "queued") {
    // The one and only automatic attempt, committed before the provider is
    // called so a lost response still leaves evidence behind.
    const marked = await client.query(
      `update public.collection_requests
          set status = 'starting', start_attempted_at = now(), started_at = null, updated_at = now()
        where id = $1 and start_attempted_at is null and status = 'queued'`,
      [requestId],
    );
    if (marked.rowCount === 1) {
      await audit(client, request.requested_by, "collection.start_attempted", requestId, {});
      return { request, settings, markedForStart: true, claimAction: "start_attempted" as const, claimedTo: "starting" };
    }
    // Somebody else marked it first; nothing to do this tick.
    return { request, settings, markedForStart: false, claimAction: "not_claimed" as const, claimedTo: request.status };
  }

  if (request.status === "starting" && request.provider_run_id === null) {
    await client.query(
      `update public.collection_requests
          set status = 'provider_start_uncertain', next_check_at = now() + make_interval(secs => $2),
              updated_at = now()
        where id = $1`,
      [requestId, FIRST_CHECK_SECONDS],
    );
    await audit(client, request.requested_by, "collection.start_uncertain", requestId,
      { reason: "the worker did not report a start outcome" });
    return {
      request, settings, markedForStart: false,
      claimAction: "start_uncertain" as const, claimedTo: "provider_start_uncertain",
    };
  }

  return { request, settings, markedForStart: false, claimAction: "not_claimed" as const, claimedTo: request.status };
}

/** The single automatic provider start. Called once per marked attempt. */
async function startOnce(
  requestId: string,
  request: RequestRow,
  settings: Settings,
  provider: CollectionProvider,
): Promise<AdvanceOutcome> {
  const maxRecords = typeof request.params.max_records === "number" ? request.params.max_records : null;
  if (!settings.actorBuild || !settings.runTimeoutMinutes || !request.source_url
    || !request.cost_reserved_usd || maxRecords === null) {
    // Configuration is incomplete: nothing is sent, and the request goes back
    // to queued so a corrected configuration can still start it.
    return finish(requestId, request, {
      action: "not_configured", status: "queued",
      detail: "actor build, run timeout, source URL, reservation or record cap missing",
      clearStartMarker: true,
    });
  }

  const outcome = await provider.startRun({
    sourceUrl: request.source_url,
    // The request's own id: the only way an uncertain start is recognised later.
    runTag: request.id,
    maxRecords,
    maxTotalChargeUsd: request.cost_reserved_usd,
    timeoutSeconds: settings.runTimeoutMinutes * 60,
    build: settings.actorBuild,
    memoryMbytes: RUN_MEMORY_MBYTES,
  });

  if (outcome.outcome === "started") {
    return finish(requestId, request, {
      action: "started", status: "running", run: outcome.run, audit: "collection.started",
    });
  }
  if (outcome.outcome === "refused") {
    return finish(requestId, request, {
      action: "start_refused", status: "failed", audit: "collection.failed",
      errorClass: outcome.reason === "not_configured" ? "provider_unreachable" : "provider_start_failed",
      detail: outcome.detail,
    });
  }
  // Unknown: a run may exist. Never start again; reconcile by reading.
  return finish(requestId, request, {
    action: "start_uncertain", status: "provider_start_uncertain",
    audit: "collection.start_uncertain", detail: outcome.detail,
  });
}

/**
 * Reconciliation: read-only, bounded, and never a second start.
 *
 * A candidate matches only on both the runTag and the source URL in its own
 * input record. One match is attached; none inside the window keeps waiting;
 * more than one, or the window expiring, asks a person.
 */
async function reconcile(
  requestId: string,
  request: RequestRow,
  settings: Settings,
  provider: CollectionProvider,
): Promise<AdvanceOutcome> {
  const pageSize = settings.reconcilePageSize ?? 20;
  const windowMinutes = settings.reconcileWindowMinutes;
  const expired = windowMinutes !== null && request.start_attempted_at !== null
    && Date.now() - new Date(request.start_attempted_at).getTime() > windowMinutes * 60_000;

  const lookup = await findOriginalStart(provider, {
    id: request.id,
    sourceUrl: request.source_url,
    startAttemptedAt: request.start_attempted_at,
  }, pageSize);
  if (lookup.kind === "unavailable") {
    return finish(requestId, request, {
      action: "reconcile_unresolved", status: "provider_start_uncertain",
      detail: lookup.detail,
      requiresAdmin: expired,
    });
  }
  if (lookup.kind === "match") {
    const conflict = identityConflict(request, lookup.run);
    if (conflict) return failClosed(requestId, request, conflict);
    return finish(requestId, request, {
      action: "reconciled", status: "running", run: lookup.run, audit: "collection.reconciled",
    });
  }
  if (lookup.kind === "ambiguous") {
    // Two runs carrying this request's tag is not something to guess at.
    return finish(requestId, request, {
      action: "reconcile_ambiguous", status: "provider_start_uncertain",
      requiresAdmin: true, audit: "collection.requires_admin",
      detail: `${lookup.count} runs carry this request's tag`,
    });
  }
  return finish(requestId, request, {
    action: "reconcile_unresolved", status: "provider_start_uncertain",
    requiresAdmin: expired,
    audit: expired ? "collection.requires_admin" : undefined,
    detail: expired ? "no matching run inside the reconciliation window" : "no matching run yet",
  });
}

/** One GET per tick. A status nobody documented is never success. */
async function pollRun(
  requestId: string,
  request: RequestRow,
  provider: CollectionProvider,
): Promise<AdvanceOutcome> {
  if (!request.provider_run_id) {
    return finish(requestId, request, {
      action: "start_uncertain", status: "provider_start_uncertain",
      detail: "running without an identified run",
    });
  }
  const read = await provider.readRun(request.provider_run_id);
  if (!read.ok) {
    return finish(requestId, request, {
      action: "still_running", status: "running", detail: `provider unavailable: ${read.detail}`,
    });
  }
  const run = read.value;

  const conflict = identityConflict(request, run);
  if (conflict) return failClosed(requestId, request, conflict);

  if (run.succeeded) {
    // The settlement gate (C09) owns everything after this. A terminal run is
    // not yet a complete result, so nothing imports here.
    return finish(requestId, request, {
      action: "provider_succeeded", status: "settling", run,
      audit: "collection.provider_succeeded",
    });
  }
  if (run.terminal) {
    return finish(requestId, request, {
      action: "provider_failed", status: "failed", run, audit: "collection.failed",
      errorClass: run.status === "TIMED-OUT" ? "provider_timed_out"
        : run.status === "ABORTED" ? "provider_aborted" : "provider_run_failed",
      detail: `provider run ${run.status.toLowerCase()}`,
    });
  }
  return finish(requestId, request, { action: "still_running", status: "running", run });
}

/**
 * Persists one transition, releases the lease and schedules the next check.
 *
 * Provider identifiers and scrubbed error text are written to the admin
 * columns; nothing here touches the user-safe group beyond the status itself.
 */
async function finish(
  requestId: string,
  request: RequestRow,
  outcome: {
    action: AdvanceAction;
    status: string;
    run?: ProviderRun;
    audit?: string;
    errorClass?: string;
    detail?: string;
    requiresAdmin?: boolean;
    /** Only a fail-closed stop replaces a class that is already recorded. */
    overwriteErrorClass?: boolean;
    clearStartMarker?: boolean;
  },
): Promise<AdvanceOutcome> {
  const terminal = outcome.status === "failed" || outcome.status === "succeeded";
  const nextCheck = terminal || outcome.status === "settling" ? null : backoffSeconds(request.attempt);
  const detail = outcome.detail ? scrubProviderMessage(outcome.detail) : null;

  await withTransaction(async (client) => {
    await client.query(
      `update public.collection_requests
          set status = $2,
              provider = coalesce(provider, $3),
              -- Identity is written once and never rewritten: a later read must
              -- not be able to point this request at a different run.
              provider_run_id = coalesce(provider_run_id, $4),
              provider_dataset_id = coalesce(provider_dataset_id, $5),
              provider_actor_build = coalesce(provider_actor_build, $6),
              -- The provider's own charge-bearing start. Never invented, never
              -- taken from our POST time, the finish or a cost read, and never
              -- moved once it is known.
              started_at = coalesce(started_at, $7),
              finished_at = case when $8 then coalesce(finished_at, now()) else finished_at end,
              error_class = case when $14 then $9 else coalesce($9, error_class) end,
              -- A terminal run has a bill to settle, so cost reconciliation
              -- (C10) gets its own first check here. It runs on its own
              -- schedule from now on, in any request status.
              cost_next_check_at = case when $16 then coalesce(cost_next_check_at, now())
                                        else cost_next_check_at end,
              -- Billing evidence at the terminal moment, kept as a diagnostic.
              -- It is never a settlement condition and never an accounting
              -- figure: C10 owns cost, and C01-B showed this number lags.
              result_charged_items = coalesce(result_charged_items, $15),
              error_detail = coalesce($10, error_detail),
              requires_admin = case when $11 then true else requires_admin end,
              start_attempted_at = case when $12 then null else start_attempted_at end,
              next_check_at = case when $13::int is null then null
                                   else now() + make_interval(secs => $13::int) end,
              lease_owner = null,
              lease_expires_at = null,
              updated_at = now()
        where id = $1`,
      [
        requestId,
        outcome.status,
        outcome.run ? "apify" : null,
        outcome.run?.runId ?? null,
        outcome.run?.datasetId ?? null,
        outcome.run?.buildNumber ?? null,
        outcome.run?.startedAt ?? null,
        terminal,
        outcome.errorClass ?? null,
        detail,
        outcome.requiresAdmin === true,
        outcome.clearStartMarker === true,
        nextCheck,
        outcome.overwriteErrorClass === true,
        outcome.run?.usage.chargedItems ?? null,
        outcome.run?.terminal === true && outcome.run.runId !== "",
      ],
    );
    if (outcome.audit) {
      await audit(client, request.requested_by, outcome.audit, requestId, {
        from: request.status, to: outcome.status,
        ...(outcome.errorClass ? { error_class: outcome.errorClass } : {}),
      });
    }
  });

  return {
    requestId, action: outcome.action, from: request.status, to: outcome.status,
    ...(detail ? { detail } : {}),
  };
}

/**
 * Stops on contradictory evidence: the state does not move, the persisted
 * identity stands, and an admin is asked.
 *
 * It carries its own class (0038). An identity conflict is neither an uncertain
 * start nor a dataset that never settled, and labelling it with either of those
 * would send an admin to the wrong recovery. The class is written even over an
 * earlier one, because this is the reason the request stopped.
 */
async function failClosed(
  requestId: string,
  request: RequestRow,
  detail: string,
): Promise<AdvanceOutcome> {
  return finish(requestId, request, {
    action: "identity_conflict", status: request.status, requiresAdmin: true,
    audit: "collection.requires_admin", errorClass: "provider_identity_conflict",
    overwriteErrorClass: true, detail,
  });
}

/** Doubling back-off, bounded. A busy run is re-checked, not waited on. */
export function backoffSeconds(attempt: number): number {
  const seconds = FIRST_CHECK_SECONDS * 2 ** Math.max(0, attempt - 1);
  return Math.min(seconds, MAX_CHECK_SECONDS);
}

async function readSettings(client: PoolClient): Promise<Settings> {
  const { rows } = await client.query<{ key: string; value: unknown }>(
    "select key, value from public.app_settings where key like 'collector.%'",
  );
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  const number = (name: string) => {
    const value = settings.get(`collector.${name}`);
    return typeof value === "number" ? value : null;
  };
  const text = (name: string) => {
    const value = settings.get(`collector.${name}`);
    return typeof value === "string" ? value : null;
  };
  return {
    actorBuild: text("actor_build"),
    runTimeoutMinutes: number("run_timeout_minutes"),
    // A lease that is missing is short rather than infinite: a stuck row must
    // become claimable again.
    leaseSeconds: number("lease_seconds") ?? 120,
    reconcileWindowMinutes: number("reconcile_window_minutes"),
    reconcilePageSize: number("reconcile_page_size"),
    resultSettleSeconds: number("result_settle_seconds"),
    resultSettleWindowMinutes: number("result_settle_window_minutes"),
    maxExportBytes: number("max_export_bytes"),
  };
}

async function audit(
  client: PoolClient,
  actor: string,
  action: string,
  requestId: string,
  after: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `insert into public.audit_logs (actor, action, entity_type, entity_id, after)
     values ($1, $2, 'collection_request', $3, $4::jsonb)`,
    [actor, action, requestId, JSON.stringify(after)],
  );
}

/**
 * Exposed so the scheduler ticket can claim exactly the states this machine
 * advances. C09 added `settling` and `importing`, so this is now every
 * non-terminal state — plus, in the claim predicate above, a `succeeded`
 * request whose media enqueue has not happened yet.
 */
export const ADVANCEABLE_STATES = [...CONCURRENCY_SLOT_STATES];

// ---------------------------------------------------------------------------
// C09 — the provider result settlement gate, the canonical import, and the one
// step that follows it.
// ---------------------------------------------------------------------------

/**
 * One settle tick: read the dataset, judge it against the previous reading,
 * persist what was seen, and stop.
 *
 * Two readings taken in the same tick would be one observation wearing two
 * hats, so this never reads twice: it records, schedules the next check at
 * least `result_settle_seconds` away, and leaves.
 */
async function settle(
  requestId: string,
  request: RequestRow,
  settings: Settings,
  provider: CollectionProvider,
  now: Date,
): Promise<AdvanceOutcome> {
  const settleSeconds = settings.resultSettleSeconds;
  if (settleSeconds === null || settings.resultSettleWindowMinutes === null) {
    // Unset is unset. Nothing invents an interval, and nothing imports without one.
    return settleFinish(requestId, request, {
      action: "not_configured", status: "settling", nextSeconds: backoffSeconds(request.attempt),
      detail: "result_settle_seconds or result_settle_window_minutes is unset",
    });
  }

  const observedAt = now.toISOString();
  const expired = settlementExpired(
    request.result_settle_reopened_at ?? request.result_settle_started_at,
    observedAt, settings.resultSettleWindowMinutes,
  );
  /** Not ready this tick: either wait, or — once the window is spent — ask a person. */
  const notReady = (detail: string, observation?: SettlementObservation) => (
    expired
      ? settleFinish(requestId, request, {
          action: "result_unsettled", status: "settling", observation, requiresAdmin: true,
          errorClass: "provider_result_unsettled", audit: "collection.requires_admin",
          nextSeconds: null, detail,
        })
      : settleFinish(requestId, request, {
          action: "result_observed", status: "settling", observation,
          nextSeconds: settleSeconds, detail, startWindowAt: observedAt,
        })
  );

  const datasetId = request.provider_dataset_id;
  if (!datasetId) {
    // A terminal success naming no dataset is not something to guess at, and
    // waiting for one to appear would never end.
    return settleFinish(requestId, request, {
      action: "result_unsettled", status: "settling", requiresAdmin: true,
      errorClass: "provider_result_unsettled", audit: "collection.requires_admin",
      nextSeconds: null, detail: "the provider run identified no dataset",
    });
  }

  const metadata = await provider.readDatasetMetadata(datasetId);
  if (!metadata.ok) return notReady(`dataset metadata unavailable: ${metadata.detail}`);
  // Missing or malformed pagination evidence fails closed. It is never read as
  // "no items" — that is exactly how an empty result comes to look complete.
  const total = await provider.readDatasetItemTotal(datasetId);
  if (!total.ok) return notReady(`pagination total unreadable: ${total.detail}`);

  const current: SettlementObservation = {
    itemCount: metadata.value.itemCount,
    modifiedAt: canonicalInstant(metadata.value.modifiedAt),
    paginationTotal: total.value,
    observedAt,
  };
  const prior: SettlementObservation | null = request.result_observed_at === null ? null : {
    itemCount: request.result_item_count ?? -1,
    modifiedAt: canonicalInstant(request.result_modified_at),
    paginationTotal: request.result_pagination_total ?? -1,
    observedAt: canonicalInstant(request.result_observed_at) ?? observedAt,
  };

  const assessment = assessSettlement(prior, current, settleSeconds);
  if (assessment.verdict === "ready") {
    // The gate is passed. The import is the next tick's bounded work, so one
    // advance stays one transition and `importing` is a state a dead worker can
    // be recovered from.
    return settleFinish(requestId, request, {
      action: "result_ready", status: "importing", observation: current,
      markImportAttempt: true, audit: "collection.result_ready", nextSeconds: 0,
      detail: `settled at ${current.itemCount} items`,
    });
  }
  return notReady(
    assessment.verdict === "first" ? `first observation: ${current.itemCount} items` : assessment.detail,
    current,
  );
}

/**
 * Persists one settle tick.
 *
 * An observation replaces the previous one, because the baseline is whatever
 * was last actually seen. The window's start is written once: a request must
 * not be able to postpone its own timeout by observing again.
 */
async function settleFinish(
  requestId: string,
  request: RequestRow,
  write: {
    action: AdvanceAction;
    status: string;
    observation?: SettlementObservation;
    requiresAdmin?: boolean;
    errorClass?: string;
    audit?: string;
    detail?: string;
    markImportAttempt?: boolean;
    startWindowAt?: string;
    /** Forget the settled baseline entirely; the next reading is a first one. */
    clearBaseline?: boolean;
    /** Seconds until the next check. null stops automatic polling entirely. */
    nextSeconds: number | null;
  },
): Promise<AdvanceOutcome> {
  const observation = write.observation ?? null;
  const detail = write.detail ? scrubProviderMessage(write.detail) : null;

  await withTransaction(async (client) => {
    await client.query(
      `update public.collection_requests
          set status = $2,
              -- $14 clears the baseline outright: used when the disagreement is
              -- with the items themselves, so there is no new metadata reading
              -- to carry forward and the next tick must observe from scratch.
              result_item_count = case when $14 then null else coalesce($3, result_item_count) end,
              result_modified_at = case when $14 then null
                                        when $4 then $5 else result_modified_at end,
              result_pagination_total = case when $14 then null
                                             else coalesce($6, result_pagination_total) end,
              result_observed_at = case when $14 then null else coalesce($7, result_observed_at) end,
              -- Written once: the window runs from the first settle tick.
              result_settle_started_at = coalesce(result_settle_started_at, $8),
              requires_admin = case when $9 then true else requires_admin end,
              error_class = coalesce($10, error_class),
              error_detail = coalesce($11, error_detail),
              import_attempted_at = case when $12 then coalesce(import_attempted_at, now())
                                         else import_attempted_at end,
              next_check_at = case when $13::int is null then null
                                   else now() + make_interval(secs => $13::int) end,
              lease_owner = null,
              lease_expires_at = null,
              updated_at = now()
        where id = $1`,
      [
        requestId,
        write.status,
        observation?.itemCount ?? null,
        observation !== null,
        observation?.modifiedAt ?? null,
        observation?.paginationTotal ?? null,
        observation?.observedAt ?? null,
        write.startWindowAt ?? null,
        write.requiresAdmin === true,
        write.errorClass ?? null,
        detail,
        write.markImportAttempt === true,
        write.nextSeconds,
        write.clearBaseline === true,
      ],
    );
    // One event per thing that actually happened. A claimed request always had
    // requires_admin = false, so the requires-admin event cannot repeat.
    if (write.audit) {
      await audit(client, request.requested_by, write.audit, requestId, {
        from: request.status, to: write.status,
        ...(observation ? { item_count: observation.itemCount } : {}),
        ...(write.errorClass ? { error_class: write.errorClass } : {}),
      });
    }
  });

  return {
    requestId, action: write.action, from: request.status, to: write.status,
    ...(detail ? { detail } : {}),
  };
}

/**
 * The import step: read exactly what settled, convert it, commit it once.
 *
 * Adoption comes first. A commit can land and the worker die before the request
 * is linked to it; the canonical run is then already correct, and the only
 * honest thing to do is find it and attach. Re-importing would be the mistake,
 * and the unique index on the request id inside the run's quality summary is
 * there to make that mistake impossible rather than merely unlikely.
 */
async function importResult(
  requestId: string,
  request: RequestRow,
  settings: Settings,
  provider: CollectionProvider,
  now: Date,
): Promise<AdvanceOutcome> {
  const adopted = await findCommittedRun(requestId);
  if (adopted) {
    return complete(requestId, request, {
      action: "import_adopted", audit: "collection.import_adopted",
      collectionRunId: adopted.runId, datasetId: adopted.datasetId,
      result: {
        ads: adopted.ads, pages: adopted.pages, unresolved: adopted.unresolved, quarantined: null,
      },
      providerItemCount: request.result_item_count,
      detail: "a canonical run for this request already exists",
    });
  }

  if (settings.maxExportBytes === null) {
    // No transition: nothing has been read, nothing written, and an unset cap
    // is not a reason to move the request anywhere.
    return settleFinish(requestId, request, {
      action: "not_configured", status: "importing",
      nextSeconds: backoffSeconds(request.attempt), detail: "max_export_bytes is unset",
    });
  }
  const datasetId = request.provider_dataset_id;
  const maxRecords = typeof request.params.max_records === "number" ? request.params.max_records : null;
  const settled = request.result_item_count;
  if (!datasetId || maxRecords === null || settled === null || !request.source_url
    // Defensive: admission always writes a non-blank name. A row that reaches
    // here without one was not admitted properly, and naming it now would give
    // a retry a different name from its first attempt.
    || !request.dataset_name?.trim()) {
    return failImport(requestId, request, "adapter_rejected",
      "the request lacks the dataset, record cap, settled count, source URL or dataset name the import needs");
  }

  const intended = intendedCount(settled, maxRecords);
  if (intended === 0) {
    // Zero is a claim like any other, and it is re-checked at the moment it
    // would become final: a dataset that filled in after it settled empty must
    // not be recorded as a collection that found nothing.
    const stillEmpty = await verifyUnchanged(provider, datasetId, request, now);
    if (!stillEmpty.ok) return resettle(requestId, request, settings, stillEmpty);
    // No PT Glory dataset is created for zero ads — an empty dataset would be a
    // collection that never happened — and the request keeps the provider
    // evidence, counts and audit history.
    return complete(requestId, request, {
      action: "zero_result", audit: "collection.zero_result",
      collectionRunId: null, datasetId: null,
      result: { ads: 0, pages: 0, unresolved: 0, quarantined: 0 },
      providerItemCount: 0, stopReason: null,
      // Nothing was committed, so there is nothing downstream to enqueue.
      mediaSettled: true,
      detail: "the provider run returned no ads",
    });
  }

  // The fence, before the fetch: a dataset that settled minutes ago may have
  // moved since, and the settlement observations alone cannot see that.
  const before = await verifyUnchanged(provider, datasetId, request, now);
  if (!before.ok) return resettle(requestId, request, settings, before);

  const fetched = await fetchItems(provider, datasetId, intended);
  if (!fetched.ok) {
    return settleFinish(requestId, request, {
      action: "import_incomplete", status: "importing",
      nextSeconds: backoffSeconds(request.attempt), detail: fetched.detail,
    });
  }

  // And again after it. Reading the range takes time, and the only way to know
  // the dataset held still for all of it is to check both ends against the same
  // baseline.
  const after = await verifyUnchanged(provider, datasetId, request, now);
  if (!after.ok) return resettle(requestId, request, settings, after);

  if (fetched.items.length !== intended) {
    // Condition 5 of the gate, checked where the items actually are.
    return resettle(requestId, request, settings, {
      observation: null,
      // The metadata never moved; the items disagreed with it. There is no
      // reading worth keeping, so the whole baseline goes.
      clearBaseline: true,
      detail: `fetched ${fetched.items.length} of the ${intended} items that had settled`,
    });
  }

  const stop = {
    runSucceeded: true,
    ceilingReached: request.ceiling_reached,
    guardStopped: false,
    // C09 has no positive evidence that a source ended: the provider reports no
    // exhaustion flag. SUCCEEDED alone, and a total alone, prove nothing (C01-B),
    // so a run that is not limit-capped stops for an unknown reason.
    exhaustionEvidence: false,
  };
  const exported = adaptApifyItems({
    items: fetched.items,
    collectionRequestId: requestId,
    scope: {
      country: paramText(request.params.country) ?? "",
      query: paramText(request.params.keyword) ?? "",
      activeStatus: request.params.active_status === "all" ? "all" : "active",
    },
    sourceUrl: request.source_url,
    maxRecords,
    maxExportBytes: settings.maxExportBytes,
    generatedAt: now.toISOString(),
    stop,
  });
  if (!exported.ok) return failImport(requestId, request, "export_too_large", exported.detail);

  // The background path never calls previewImport: that wrapper exists to count
  // existing ads for a signed-in person's confirm screen, and there is no
  // session here. The validation and normalization underneath are the same.
  const analysis = analyzeImport(exported.text);
  if (!analysis.ok) return failImport(requestId, request, "adapter_rejected", `${analysis.reason}: ${analysis.detail}`);

  let committed;
  try {
    committed = await commitImport({
      canonical: analysis.canonical,
      categoryId: request.category_id,
      // Exactly the name admission persisted. It was normalized once, there,
      // before the provider was contacted — so there is nothing to tidy here
      // and nothing that could differ between an import and its retry.
      datasetName: request.dataset_name,
      // The person who asked for the collection owns the result. Never the
      // worker, the scheduler or the database role that happened to write it.
      actorId: request.requested_by,
    });
  } catch (error) {
    if (isRequestAlreadyCommitted(error)) {
      // The database refused a second canonical run for this request. That is
      // the barrier working; the existing run is the answer.
      const existing = await findCommittedRun(requestId);
      if (existing) {
        return complete(requestId, request, {
          action: "import_adopted", audit: "collection.import_adopted",
          collectionRunId: existing.runId, datasetId: existing.datasetId,
          result: {
            ads: existing.ads, pages: existing.pages, unresolved: existing.unresolved, quarantined: null,
          },
          providerItemCount: settled,
          detail: "a canonical run for this request already exists",
        });
      }
    }
    throw error;
  }

  return complete(requestId, request, {
    action: "imported", audit: "collection.imported",
    collectionRunId: committed.collectionRunId, datasetId: committed.datasetId,
    result: {
      ads: committed.saved.ads, pages: committed.saved.pages,
      unresolved: analysis.computed.unresolvedCount, quarantined: committed.quarantined.count,
    },
    providerItemCount: settled,
    stopReason: stopReason({ items: fetched.items, maxRecords, stop }),
    detail: `imported ${committed.saved.ads} ads`,
  });
}

/** Reads the intended range in bounded pages. One pass, no waiting, no retry loop. */
async function fetchItems(
  provider: CollectionProvider,
  datasetId: string,
  intended: number,
): Promise<{ ok: true; items: unknown[] } | { ok: false; detail: string }> {
  const items: unknown[] = [];
  while (items.length < intended) {
    const limit = Math.min(ITEM_PAGE_SIZE, intended - items.length);
    const page = await provider.readDatasetItems(datasetId, { offset: items.length, limit });
    if (!page.ok) return { ok: false, detail: `dataset items unreadable: ${page.detail}` };
    if (page.value.items.length === 0) break;
    items.push(...page.value.items);
  }
  return { ok: true, items };
}

/**
 * The final fence: the dataset is still exactly what settled.
 *
 * Checked immediately before the fetch and again immediately after it, both
 * times against the SAME persisted baseline. Settlement proves the dataset had
 * stopped moving some minutes ago; only this proves it held still while the
 * items were actually being read.
 *
 * Evidence that cannot be read is not evidence that nothing changed, so it
 * fails the fence too.
 */
type FenceResult =
  | { ok: true }
  | { ok: false; observation: SettlementObservation | null; detail: string };

async function verifyUnchanged(
  provider: CollectionProvider,
  datasetId: string,
  request: RequestRow,
  now: Date,
): Promise<FenceResult> {
  const metadata = await provider.readDatasetMetadata(datasetId);
  if (!metadata.ok) {
    return { ok: false, observation: null, detail: `dataset metadata unavailable: ${metadata.detail}` };
  }
  const total = await provider.readDatasetItemTotal(datasetId);
  if (!total.ok) {
    return { ok: false, observation: null, detail: `pagination total unreadable: ${total.detail}` };
  }

  const current: SettlementObservation = {
    itemCount: metadata.value.itemCount,
    modifiedAt: canonicalInstant(metadata.value.modifiedAt),
    paginationTotal: total.value,
    observedAt: now.toISOString(),
  };
  const changed = current.itemCount !== request.result_item_count
    || current.modifiedAt !== canonicalInstant(request.result_modified_at)
    || current.paginationTotal !== current.itemCount
    || current.paginationTotal !== request.result_pagination_total;

  return changed
    ? {
        ok: false,
        observation: current,
        detail: `the dataset changed after it settled: ${request.result_item_count} → ${current.itemCount} items`,
      }
    : { ok: true };
}

/**
 * The result moved before the commit. Nothing was written.
 *
 * The request goes back to `settling` — the one backward transition, and only
 * before a canonical commit — carrying the new evidence as its baseline, so two
 * fresh stable observations are needed again. `result_settle_started_at` is
 * untouched: the window measures how long this result has been refusing to
 * settle, and a change is the reason to keep counting, not to start over.
 */
async function resettle(
  requestId: string,
  request: RequestRow,
  settings: Settings,
  failure: { observation: SettlementObservation | null; detail: string; clearBaseline?: boolean },
): Promise<AdvanceOutcome> {
  return settleFinish(requestId, request, {
    action: "import_incomplete", status: "settling",
    observation: failure.observation ?? undefined,
    clearBaseline: failure.clearBaseline === true,
    // Only a real change is announced; an unreadable provider is not an event.
    audit: failure.observation ? "collection.result_changed" : undefined,
    nextSeconds: settings.resultSettleSeconds ?? FIRST_CHECK_SECONDS,
    detail: failure.detail,
  });
}

/** The canonical run this request already produced, if it produced one. */
async function findCommittedRun(requestId: string): Promise<
  { runId: string; datasetId: string | null; ads: number; pages: number; unresolved: number } | null
> {
  return withTransaction((client) => findCommittedRunWithClient(client, requestId));
}

/** The unique index that makes one canonical run per request a database fact. */
function isRequestAlreadyCommitted(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  const constraint = (error as { constraint?: unknown }).constraint;
  return code === "23505" && constraint === "collection_runs_request_once";
}

/** Links the committed result to the request and finishes it. */
async function complete(
  requestId: string,
  request: RequestRow,
  outcome: {
    action: AdvanceAction;
    audit: string;
    collectionRunId: string | null;
    datasetId: string | null;
    result: { ads: number; pages: number; unresolved: number; quarantined: number | null };
    providerItemCount: number | null;
    stopReason?: string | null;
    mediaSettled?: boolean;
    detail?: string;
  },
): Promise<AdvanceOutcome> {
  const detail = outcome.detail ? scrubProviderMessage(outcome.detail) : null;
  await withTransaction(async (client) => {
    await client.query(
      `update public.collection_requests
          set status = 'succeeded',
              collection_run_id = coalesce(collection_run_id, $2),
              dataset_id = coalesce(dataset_id, $3),
              result = $4::jsonb,
              provider_item_count = coalesce($5, provider_item_count),
              stop_reason = coalesce($6, stop_reason),
              error_detail = coalesce($7, error_detail),
              finished_at = coalesce(finished_at, now()),
              -- Zero result: nothing was committed, so nothing is owed
              -- downstream and the request is finished outright.
              media_enqueued_at = case when $8 then coalesce(media_enqueued_at, now())
                                       else media_enqueued_at end,
              -- One more tick, for the media enqueue that follows the commit.
              next_check_at = case when $8 then null else now() end,
              lease_owner = null,
              lease_expires_at = null,
              updated_at = now()
        where id = $1`,
      [
        requestId, outcome.collectionRunId, outcome.datasetId, JSON.stringify(outcome.result),
        outcome.providerItemCount, outcome.stopReason ?? null, detail, outcome.mediaSettled === true,
      ],
    );
    await audit(client, request.requested_by, outcome.audit, requestId, {
      from: request.status, to: "succeeded", ...outcome.result,
    });
  });
  return {
    requestId, action: outcome.action, from: request.status, to: "succeeded",
    ...(detail ? { detail } : {}),
  };
}

/** Nothing was written. The request fails with the class that says why. */
async function failImport(
  requestId: string,
  request: RequestRow,
  errorClass: "adapter_rejected" | "export_too_large",
  detail: string,
): Promise<AdvanceOutcome> {
  const scrubbed = scrubProviderMessage(detail);
  await withTransaction(async (client) => {
    await client.query(
      `update public.collection_requests
          set status = 'failed',
              error_class = coalesce(error_class, $2),
              error_detail = coalesce(error_detail, $3),
              finished_at = coalesce(finished_at, now()),
              next_check_at = null,
              lease_owner = null,
              lease_expires_at = null,
              updated_at = now()
        where id = $1`,
      [requestId, errorClass, scrubbed],
    );
    await audit(client, request.requested_by, "collection.failed", requestId, {
      from: request.status, to: "failed", error_class: errorClass,
    });
  });
  return { requestId, action: "import_failed", from: request.status, to: "failed", detail: scrubbed };
}

/**
 * The one step after the canonical commit.
 *
 * Separate on purpose: a CDN or queue problem must not be able to undo, repeat
 * or hold up an import that is already durable. `enqueueRun` only inserts, and
 * only where nothing exists, so a retry cannot enqueue the same observation
 * twice.
 */
async function enqueueMedia(requestId: string, request: RequestRow): Promise<AdvanceOutcome> {
  if (!request.collection_run_id) {
    // Succeeded with no canonical run is the zero-result case: nothing to queue.
    await markMediaSettled(requestId);
    return { requestId, action: "media_enqueued", from: "succeeded", to: "succeeded", detail: "no canonical run" };
  }
  let queued: number;
  try {
    queued = (await enqueueRun(request.collection_run_id)).queued;
  } catch (error) {
    // The import stands. Only this step is retried.
    const detail = scrubProviderMessage(error instanceof Error ? error.message : String(error));
    await withTransaction(async (client) => {
      await client.query(
        `update public.collection_requests
            set next_check_at = now() + make_interval(secs => $2),
                lease_owner = null, lease_expires_at = null, updated_at = now()
          where id = $1`,
        [requestId, backoffSeconds(request.attempt)],
      );
    });
    return { requestId, action: "media_enqueue_retry", from: "succeeded", to: "succeeded", detail };
  }

  await markMediaSettled(requestId);
  await withTransaction((client) =>
    audit(client, request.requested_by, "collection.media_enqueued", requestId, { queued }));
  return { requestId, action: "media_enqueued", from: "succeeded", to: "succeeded", detail: `queued ${queued}` };
}

async function markMediaSettled(requestId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `update public.collection_requests
          set media_enqueued_at = coalesce(media_enqueued_at, now()),
              next_check_at = null,
              lease_owner = null,
              lease_expires_at = null,
              updated_at = now()
        where id = $1`,
      [requestId],
    );
  });
}

function paramText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
