import type { PoolClient } from "pg";
import { withTransaction } from "../db/privileged.ts";
import { AuthorizationError, satisfies, type Role } from "../auth/role-model.ts";
import { findCommittedRun } from "./adoption.ts";
import { findOriginalStart, identityConflict } from "./reconcile.ts";
import { scrubProviderMessage } from "./provider.ts";
import type { CollectionProvider } from "./provider.ts";

/**
 * Admin recovery (C11): what a person may do about a collection that stopped.
 *
 * Every action here works on the request, the run and the evidence that already
 * exist. The one provider dependency is a bounded, read-only reconciliation of
 * an uncertain original start; it imports no provider client and has no start
 * path, so no admin decision can cost money.
 *
 * What the actions actually do is unblock the frozen machines: clear the admin
 * hold only after safe evidence, put work back on the schedule, or preserve an
 * unresolved hold. A new paid collection is a new request by a user, through
 * admission, the budget, the ceiling and the concurrency limit — never a repair.
 *
 * Each action reads and writes in one privileged transaction, and eligibility is
 * expressed in the UPDATE's own WHERE clause: two admins acting at once cannot
 * both succeed, because the second one's row no longer matches.
 */

export type Admin = { id: string; role: Role };

export type RecoveryAction =
  | "settlement_retried"
  | "collection_failed"
  | "original_start_reconciled"
  | "cost_retried"
  | "reservation_released";

export type RecoveryFailureReason = "not_eligible" | "reason_required" | "not_resolved";

export type RecoveryResult =
  | { ok: true; action: RecoveryAction; requestId: string }
  | { ok: false; reason: RecoveryFailureReason; detail: string };

/**
 * The authorization boundary.
 *
 * Server-side and mandatory: nothing here is protected by a hidden button. A
 * caller without an admin role is refused before a connection is opened, the
 * same way the import write path is.
 */
function requireAdmin(admin: Admin): void {
  if (!admin.role) throw new AuthorizationError(401, "Sign in required");
  if (!satisfies(admin.role, "admin")) throw new AuthorizationError(403, "Requires admin role");
}

/** A recovery decision a person has to answer for needs a reason in their own words. */
function requireReason(reason: string): string | null {
  const trimmed = reason?.trim() ?? "";
  return trimmed === "" ? null : trimmed.slice(0, 500);
}

const notEligible = (detail: string): RecoveryResult => ({ ok: false, reason: "not_eligible", detail });

/**
 * Retry settlement for a result that would not settle.
 *
 * The same provider run and the same dataset: nothing is re-identified, and the
 * observations already recorded are kept. The admin hold is lifted and the
 * settle window is reopened so C09 can take its next bounded look — this action
 * reads nothing itself.
 *
 * Reopening the window records a new operational anchor in
 * `result_settle_reopened_at`. The historical `result_settle_started_at` and
 * every observation remain unchanged.
 */
export async function retrySettlement(requestId: string, admin: Admin): Promise<RecoveryResult> {
  requireAdmin(admin);
  return withTransaction(async (client) => {
    // Locked first, so the previous window start can be read and recorded, and
    // so two admins retrying at once are serialized by the database.
    const { rows } = await client.query<{
      status: string; requires_admin: boolean; error_class: string | null;
      provider_dataset_id: string | null; result_settle_started_at: Date | null;
      result_settle_reopened_at: Date | null;
    }>(
      `select status, requires_admin, error_class, provider_dataset_id,
              result_settle_started_at, result_settle_reopened_at
         from public.collection_requests where id = $1 for update`,
      [requestId],
    );
    const request = rows[0];
    if (!request || request.status !== "settling" || !request.requires_admin
      || request.error_class !== "provider_result_unsettled" || !request.provider_dataset_id) {
      return notEligible("only a settling request that is waiting for an admin on an unsettled result");
    }

    await client.query(
      `update public.collection_requests
          set requires_admin = false,
              error_class = null,
              error_detail = null,
              -- The window, and only the window. Observations, run identity and
              -- dataset identity all stand.
              result_settle_reopened_at = now(),
              next_check_at = now(),
              updated_at = now()
        where id = $1`,
      [requestId],
    );
    await audit(client, admin, "collection.recovery.settlement_retried", requestId, {
      before: {
        requires_admin: true,
        error_class: "provider_result_unsettled",
        settle_window_started_at: request.result_settle_started_at?.toISOString() ?? null,
        settle_window_reopened_at: request.result_settle_reopened_at?.toISOString() ?? null,
      },
      after: { requires_admin: false, error_class: null, settle_window_reopened_at: "now" },
    });
    return { ok: true, action: "settlement_retried", requestId };
  });
}

/**
 * Fail a collection a person has decided cannot be recovered.
 *
 * Everything that happened is kept: the provider run and dataset identity, the
 * settlement observations, the cost evidence and its schedule, the audit
 * history. Nothing is imported, no dataset is created, and the reservation is
 * not touched — failing a request has never meant the run was free.
 */
export async function failCollection(
  requestId: string,
  admin: Admin,
  reason: string,
): Promise<RecoveryResult> {
  requireAdmin(admin);
  const why = requireReason(reason);
  if (why === null) return { ok: false, reason: "reason_required", detail: "a reason is required" };

  return withTransaction(async (client) => {
    const { rows: eligible } = await client.query<{ status: string; error_class: string | null }>(
      `select status, error_class
         from public.collection_requests
        where id = $1
          and requires_admin = true
          and status in ('running', 'settling', 'importing', 'provider_start_uncertain')
        for update`,
      [requestId],
    );
    if (eligible.length === 0) {
      return notEligible("only a request that is waiting for an admin can be failed by one");
    }

    // C09 may have committed the canonical run before its request-link update.
    // Adoption is authoritative: never create the contradictory state that
    // canonical data exists while the request says failed.
    if (eligible[0].status === "importing" && await findCommittedRun(client, requestId)) {
      return notEligible("a canonical run already exists; C09 adoption must finish the request");
    }

    const { rows } = await client.query<{ status: string; error_class: string | null }>(
      `update public.collection_requests
          set status = 'failed',
              -- An uncertain start that an admin could not resolve has exactly
              -- one name. Every other class already on the row is the reason it
              -- is here, and stands.
              error_class = coalesce(error_class,
                case when status = 'provider_start_uncertain' then 'provider_start_unknown' end),
              finished_at = coalesce(finished_at, now()),
              requires_admin = false,
              next_check_at = null,
              lease_owner = null,
              lease_expires_at = null,
              updated_at = now()
        where id = $1
          and requires_admin = true
          and status in ('running', 'settling', 'importing', 'provider_start_uncertain')
        returning status, error_class`,
      [requestId],
    );
    if (rows.length === 0) {
      return notEligible("only a request that is waiting for an admin can be failed by one");
    }
    await audit(client, admin, "collection.recovery.failed", requestId, {
      before: { requires_admin: true },
      after: { status: "failed", error_class: rows[0].error_class, reason: why },
    });
    return { ok: true, action: "collection_failed", requestId };
  });
}

/**
 * Look again for the run an uncertain start may have created.
 *
 * This performs the same bounded, read-only C08 reconciliation used by the
 * machine: match on the request's tag AND its source URL in the run's INPUT
 * record. One safe match is attached; none or more than one stays unresolved.
 *
 * There is deliberately no action that starts a run again.
 */
export async function reconcileOriginalStart(
  requestId: string,
  admin: Admin,
  provider: CollectionProvider,
): Promise<RecoveryResult> {
  requireAdmin(admin);
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      status: string;
      requires_admin: boolean;
      error_class: string | null;
      source_url: string | null;
      start_attempted_at: Date | null;
      provider_run_id: string | null;
      provider_dataset_id: string | null;
      provider_actor_build: string | null;
      started_at: Date | null;
    }>(
      `select id, status, requires_admin, error_class, source_url, start_attempted_at,
              provider_run_id, provider_dataset_id, provider_actor_build, started_at
         from public.collection_requests where id = $1 for update`,
      [requestId],
    );
    const request = rows[0];
    if (!request || request.status !== "provider_start_uncertain"
      || !request.requires_admin || request.provider_run_id !== null) {
      return notEligible("only an unresolved start that is waiting for an admin, with no run attached");
    }

    const settings = await client.query<{ value: unknown }>(
      "select value from public.app_settings where key = 'collector.reconcile_page_size'",
    );
    const configuredPageSize = settings.rows[0]?.value;
    const pageSize = typeof configuredPageSize === "number" ? configuredPageSize : 20;
    const lookup = await findOriginalStart(provider, {
      id: request.id,
      sourceUrl: request.source_url,
      startAttemptedAt: request.start_attempted_at,
    }, pageSize);

    const before = {
      status: request.status,
      requires_admin: request.requires_admin,
      error_class: request.error_class,
      provider_run_id: request.provider_run_id,
    };
    if (lookup.kind !== "match") {
      const detail = lookup.kind === "ambiguous"
        ? `${lookup.count} runs carry this request's tag`
        : scrubProviderMessage(lookup.detail);
      await client.query(
        `update public.collection_requests
            set error_class = coalesce(error_class, 'provider_start_unknown'),
                updated_at = now()
          where id = $1`,
        [requestId],
      );
      await audit(client, admin, "collection.recovery.original_start_unresolved", requestId, {
        before,
        after: {
          status: request.status,
          requires_admin: true,
          provider_run_id: null,
          outcome: lookup.kind,
          detail,
        },
      });
      return { ok: false, reason: "not_resolved", detail };
    }

    const conflict = identityConflict({
      provider_run_id: request.provider_run_id,
      provider_dataset_id: request.provider_dataset_id,
      provider_actor_build: request.provider_actor_build,
      started_at: request.started_at?.toISOString() ?? null,
    }, lookup.run);
    if (conflict) {
      await client.query(
        `update public.collection_requests
            set error_class = coalesce(error_class, 'provider_start_unknown'),
                error_detail = $2, updated_at = now()
          where id = $1`,
        [requestId, conflict],
      );
      await audit(client, admin, "collection.recovery.original_start_unresolved", requestId, {
        before,
        after: {
          status: request.status,
          requires_admin: true,
          provider_run_id: null,
          outcome: "identity_conflict",
          detail: conflict,
        },
      });
      return { ok: false, reason: "not_resolved", detail: conflict };
    }

    const { rowCount } = await client.query(
      `update public.collection_requests
          set status = 'running',
              requires_admin = false,
              error_class = null,
              error_detail = null,
              provider = coalesce(provider, 'apify'),
              provider_run_id = $2,
              provider_dataset_id = coalesce(provider_dataset_id, $3),
              provider_actor_build = coalesce(provider_actor_build, $4),
              started_at = coalesce(started_at, $5),
              next_check_at = now(),
              lease_owner = null,
              lease_expires_at = null,
              updated_at = now()
        where id = $1
          and status = 'provider_start_uncertain'
          and requires_admin = true
          and provider_run_id is null`,
      [requestId, lookup.run.runId, lookup.run.datasetId, lookup.run.buildNumber, lookup.run.startedAt],
    );
    if (rowCount === 0) {
      return notEligible("the unresolved start changed while it was being reconciled");
    }
    await audit(client, admin, "collection.recovery.original_start_reconciled", requestId, {
      before,
      after: {
        status: "running",
        requires_admin: false,
        provider_run_id: lookup.run.runId,
        provider_dataset_id: lookup.run.datasetId,
        outcome: "resolved",
      },
    });
    return { ok: true, action: "original_start_reconciled", requestId };
  });
}

/**
 * Ask the provider about the bill again, after the automatic window gave up.
 *
 * Read-only work, scheduled: this puts the request back on C10's schedule and
 * reopens its window (0040). It changes no amount, no lifecycle state and no
 * `started_at`, and `cost_first_read_at` and every figure already recorded stay
 * exactly as they are.
 *
 * With no identified run there is nothing to ask about, and no run is searched
 * for on billing's account.
 */
export async function retryCostReconciliation(requestId: string, admin: Admin): Promise<RecoveryResult> {
  requireAdmin(admin);
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ cost_status: string }>(
      `update public.collection_requests
          set cost_window_reopened_at = now(),
              cost_next_check_at = now(),
              updated_at = now()
        where id = $1
          and provider_run_id is not null
          and cost_status in ('provisional', 'unreported', 'reserved')
          -- Only what the automatic window has finished with. A reconciliation
          -- already running needs no help, and a settled cost is settled.
          and cost_next_check_at is null
        returning cost_status`,
      [requestId],
    );
    if (rows.length === 0) {
      return notEligible("only an identified run whose automatic cost reconciliation has stopped");
    }
    await audit(client, admin, "collection.recovery.cost_retried", requestId, {
      before: { cost_status: rows[0].cost_status, cost_next_check_at: null },
      after: { cost_status: rows[0].cost_status, cost_window_reopened: true },
    });
    return { ok: true, action: "cost_retried", requestId };
  });
}

/**
 * Release a reservation nobody can resolve.
 *
 * This is an accounting act and nothing else: PT Glory stops holding money
 * aside for a start whose outcome was never established. It does not say the
 * run was free, that no run happened, or that the provider will not charge
 * later — `cost_status` stays `unreported` and the original reserved amount is
 * left exactly as it was recorded.
 *
 * Eligible only for the unresolved case the architecture names: an unknown
 * start with no identified run, a cost nobody could report, and a reservation
 * still held. The three release fields are written together, which is also what
 * the C04 constraint requires, and the `where` clause means a second admin
 * pressing the same button changes nothing.
 */
export async function releaseUnresolvedReservation(
  requestId: string,
  admin: Admin,
  reason: string,
): Promise<RecoveryResult> {
  requireAdmin(admin);
  const why = requireReason(reason);
  if (why === null) return { ok: false, reason: "reason_required", detail: "a reason is required" };

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ cost_reserved_usd: string | null }>(
      `update public.collection_requests
          set reservation_released_at = now(),
              reservation_released_by = $2,
              reservation_release_reason = $3,
              updated_at = now()
        where id = $1
          and status = 'failed'
          and error_class = 'provider_start_unknown'
          and provider_run_id is null
          and cost_status = 'unreported'
          and reservation_released_at is null
        returning cost_reserved_usd`,
      [requestId, admin.id, why],
    );
    if (rows.length === 0) {
      return notEligible(
        "only an unresolved unknown start with no identified run, an unreported cost and a reservation still held",
      );
    }
    await audit(client, admin, "collection.recovery.reservation_released", requestId, {
      before: { reservation_released_at: null, cost_status: "unreported" },
      after: {
        reservation_released_at: "now",
        // Recorded as what it is: PT Glory stopped holding this aside. It is
        // not a spend reduction, a refund, or a statement about actual cost.
        released_hold_usd: rows[0].cost_reserved_usd,
        cost_status: "unreported",
        reason: why,
      },
    });
    return { ok: true, action: "reservation_released", requestId };
  });
}

/**
 * One audit row per action that actually happened.
 *
 * The actor is the admin who decided, never the worker or the database role.
 * Amounts and state belong here; provider payloads and anything resembling a
 * credential do not.
 */
async function audit(
  client: PoolClient,
  admin: Admin,
  action: string,
  requestId: string,
  states: { before: Record<string, unknown>; after: Record<string, unknown> },
): Promise<void> {
  await client.query(
    `insert into public.audit_logs (actor, action, entity_type, entity_id, before, after)
     values ($1, $2, 'collection_request', $3, $4::jsonb, $5::jsonb)`,
    [admin.id, action, requestId, JSON.stringify(states.before), JSON.stringify(states.after)],
  );
}
