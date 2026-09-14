import type { PoolClient } from "pg";
import { withTransaction } from "../db/privileged.ts";
import { CONCURRENCY_SLOT_STATES } from "./budget.ts";
import {
  canonicalInstant, scrubProviderMessage,
  type CollectionProvider, type ProviderRun,
} from "./provider.ts";

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
 * What this ticket does NOT do: the settlement gate and the import (C09), cost
 * reconciliation (C10), admin recovery (C11) and the scheduler (C12). A
 * provider run that succeeds moves to `settling` and stops there.
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

/** How far before the recorded attempt a matching run may have started. */
export const RECONCILE_SKEW_SECONDS = 120;

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
  | "identity_conflict";

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
};

type Settings = {
  actorBuild: string | null;
  runTimeoutMinutes: number | null;
  leaseSeconds: number;
  reconcileWindowMinutes: number | null;
  reconcilePageSize: number | null;
};

export async function advance(
  requestId: string,
  deps: { provider: CollectionProvider; now?: Date; worker?: string },
): Promise<AdvanceOutcome> {
  const worker = deps.worker ?? `worker-${process.pid}`;

  // 1. Claim. One worker at a time, decided by the database.
  const claim = await withTransaction(async (client) => claimRequest(client, requestId, worker));
  if (!claim) return { requestId, action: "not_claimed", from: null, to: null };
  const { request, settings, markedForStart } = claim;

  // 2. One transition, outside the claim transaction: a provider call must
  //    never hold a row lock, and the start marker is already committed.
  if (markedForStart) return startOnce(requestId, request, settings, deps.provider);
  if (request.status === "provider_start_uncertain") {
    return reconcile(requestId, request, settings, deps.provider);
  }
  if (request.status === "running") return pollRun(requestId, request, deps.provider);

  // A `starting` row whose worker died is resolved inside the claim itself.
  return { requestId, action: claim.claimAction, from: request.status, to: claim.claimedTo };
}

/**
 * Claim and, where the state calls for it, commit the marker in the same
 * transaction. `starting` with no run id means a worker died mid-start: that is
 * uncertain, and it is never restarted.
 */
async function claimRequest(client: PoolClient, requestId: string, worker: string) {
  const settings = await readSettings(client);
  const claimed = await client.query<RequestRow>(
    `update public.collection_requests
        set lease_owner = $2,
            lease_expires_at = now() + make_interval(secs => $3),
            attempt = attempt + 1,
            updated_at = now()
      where id = $1
        and status in ('queued', 'starting', 'provider_start_uncertain', 'running')
        and requires_admin = false
        and (lease_expires_at is null or lease_expires_at < now())
        and (next_check_at is null or next_check_at <= now())
      returning id, status, requested_by, params, source_url, provider_run_id,
                provider_dataset_id, provider_actor_build, started_at,
                cost_reserved_usd, start_attempted_at, attempt`,
    [requestId, worker, settings.leaseSeconds],
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
  const since = new Date(
    new Date(request.start_attempted_at ?? Date.now()).getTime() - RECONCILE_SKEW_SECONDS * 1_000,
  );
  const pageSize = settings.reconcilePageSize ?? 20;
  const windowMinutes = settings.reconcileWindowMinutes;
  const expired = windowMinutes !== null && request.start_attempted_at !== null
    && Date.now() - new Date(request.start_attempted_at).getTime() > windowMinutes * 60_000;

  const runs = await provider.findRunsSince(since, pageSize);
  if (!runs.ok) {
    return finish(requestId, request, {
      action: "reconcile_unresolved", status: "provider_start_uncertain",
      detail: `provider list unavailable: ${runs.detail}`,
      requiresAdmin: expired,
    });
  }

  const matches: ProviderRun[] = [];
  for (const candidate of runs.value) {
    if (!candidate.keyValueStoreId) continue;
    const input = await provider.readRunInput({ keyValueStoreId: candidate.keyValueStoreId });
    if (!input.ok) continue;
    if (input.value.runTag === request.id && input.value.sourceUrl === request.source_url) {
      matches.push(candidate);
    }
  }

  if (matches.length === 1) {
    const conflict = identityConflict(request, matches[0]);
    if (conflict) return failClosed(requestId, request, conflict);
    return finish(requestId, request, {
      action: "reconciled", status: "running", run: matches[0], audit: "collection.reconciled",
    });
  }
  if (matches.length > 1) {
    // Two runs carrying this request's tag is not something to guess at.
    return finish(requestId, request, {
      action: "reconcile_ambiguous", status: "provider_start_uncertain",
      requiresAdmin: true, audit: "collection.requires_admin",
      detail: `${matches.length} runs carry this request's tag`,
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
 * Provider evidence that contradicts what is already persisted.
 *
 * Keeping the first value is not enough on its own: a response describing a
 * different run must not be allowed to move this request either. Identity is
 * settled once, and a contradiction is a question for a person, not something
 * to resolve by preferring one side.
 *
 * Timestamps are compared as canonical instants (C06) and exactly. There is no
 * tolerance: C05 attributes a finalized cost by the charge-bearing start, and a
 * billing-cycle boundary can fall between two consecutive milliseconds, so a
 * "close enough" start time is a different start time.
 */
export function identityConflict(
  request: {
    provider_run_id: string | null; provider_dataset_id: string | null;
    provider_actor_build: string | null; started_at: string | null;
  },
  run: ProviderRun,
): string | null {
  if (request.provider_run_id && run.runId && request.provider_run_id !== run.runId) {
    return "provider run identity does not match the run already attached";
  }
  if (request.provider_dataset_id && run.datasetId && request.provider_dataset_id !== run.datasetId) {
    return "provider dataset identity does not match the dataset already attached";
  }
  if (request.provider_actor_build && run.buildNumber && request.provider_actor_build !== run.buildNumber) {
    return "provider build does not match the build already recorded";
  }
  if (request.started_at && run.startedAt) {
    const persisted = canonicalInstant(request.started_at);
    const reported = canonicalInstant(run.startedAt);
    // An unreadable instant on either side is a conflict, not a pass: it cannot
    // be shown to be the same start.
    if (persisted === null || reported === null || persisted !== reported) {
      return "provider start time does not match the start already recorded";
    }
  }
  return null;
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

/** Exposed so the scheduler ticket can claim exactly the states this machine advances. */
export const ADVANCEABLE_STATES = CONCURRENCY_SLOT_STATES.filter(
  (status) => status !== "settling" && status !== "importing",
);
