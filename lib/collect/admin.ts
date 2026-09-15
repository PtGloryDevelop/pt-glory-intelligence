import { withTransaction } from "../db/privileged.ts";
import { AuthorizationError, satisfies, type Actor } from "../auth/role-model.ts";
import {
  assessBudget, billingWindow, contributionOf, microsToUsd, usdToMicros,
  type RequestAccounting,
} from "./budget.ts";
import { ABSOLUTE_MAX_RECORDS } from "./admission.ts";
import { MAX_BYTES } from "../collector/contract.ts";

/**
 * Admin-only collector surfaces (C13): diagnostics, usage and settings.
 *
 * Everything a normal user must never see lives behind this module, and the
 * role check is the first thing each function does — before any connection is
 * opened, because the privileged connection bypasses RLS entirely.
 *
 * It reads and writes; it never collects. Nothing here contacts a provider, and
 * no function in this file can start a run.
 */

function requireAdmin(actor: Actor | null): Actor {
  if (!actor) throw new AuthorizationError(401, "Sign in required");
  if (!satisfies(actor.role, "admin")) throw new AuthorizationError(403, "Requires admin role");
  return actor;
}

// --- diagnostics -----------------------------------------------------------------

/**
 * The internal view of one request, for the person who has to fix it.
 *
 * Identity, classes, observations and cost evidence — the same columns C04 put
 * in the admin group. Scrubbed provider text is included because it was already
 * scrubbed before it was stored; nothing here re-reads a provider.
 */
export type CollectionDiagnostics = Record<string, unknown>;

export async function readDiagnostics(
  actor: Actor | null,
  requestId: string,
): Promise<CollectionDiagnostics | null> {
  requireAdmin(actor);
  return withTransaction(async (client) => {
    const { rows } = await client.query<CollectionDiagnostics>(
      `select id, status, requires_admin, requested_by, category_id, dataset_name, source_url,
              params, result, stop_reason, provider_item_count, collection_run_id, dataset_id,
              provider, provider_actor, provider_actor_build, provider_run_id, provider_dataset_id,
              error_class, error_detail, retry_count, attempt,
              cost_status, cost_reserved_usd, cost_provisional_usd, cost_final_usd,
              cost_first_read_at, cost_finalized_at, cost_next_check_at, cost_window_reopened_at,
              cost_provisional_observed_at, ceiling_reached,
              reservation_released_at, reservation_released_by, reservation_release_reason,
              result_item_count, result_modified_at, result_pagination_total, result_observed_at,
              result_settle_started_at, result_settle_reopened_at, result_charged_items,
              lease_owner, lease_expires_at, next_check_at, start_attempted_at,
              import_attempted_at, media_enqueued_at,
              created_at, started_at, finished_at, updated_at
         from public.collection_requests where id = $1`,
      [requestId],
    );
    return rows[0] ?? null;
  });
}

// --- usage -----------------------------------------------------------------------

export type CollectorUsage = {
  configured: boolean;
  window: { start: string; end: string; index: number } | null;
  /** Exact USD text throughout. Money is never a float here. */
  finalizedActualCostUsd: string;
  heldReservationUsd: string;
  committedUsd: string;
  monthlyBudgetUsd: string | null;
  availableUsd: string | null;
  counts: { final: number; held: number; released: number; provisional: number; unreported: number };
  /**
   * True when any amount above comes from a provider figure that has not
   * settled. A provisional figure is a conservative hold, never a bill.
   */
  containsProvisional: boolean;
  detail: string | null;
};

/**
 * What the collector has committed this billing window.
 *
 * The arithmetic is C05's, unchanged and not re-derived here: this reads the
 * same rows admission reads and reports what that frozen code returns. Held
 * amounts are reservations, never reported as spend or usage.
 */
export async function readCollectorUsage(actor: Actor | null): Promise<CollectorUsage> {
  requireAdmin(actor);
  return withTransaction(async (client) => {
    const { rows: settingRows } = await client.query<{ key: string; value: unknown }>(
      "select key, value from public.app_settings where key like 'collector.%'",
    );
    const settings = new Map(settingRows.map((row) => [row.key, row.value]));
    const read = (name: string) => settings.get(`collector.${name}`) ?? null;

    const { rows: requests } = await client.query<RequestAccounting & { cost_status: RequestAccounting["cost_status"] }>(
      `select status, cost_status, cost_reserved_usd, cost_provisional_usd, cost_final_usd,
              reservation_released_at, started_at
         from public.collection_requests
        where (cost_status <> 'final' and reservation_released_at is null)
           or cost_status = 'final'`,
    );

    const anchor = read("billing_cycle_anchor");
    const length = read("billing_cycle_length_months");
    const window = typeof anchor === "string" && typeof length === "number"
      ? billingWindow(anchor, length, new Date())
      : null;

    const counts = { final: 0, held: 0, released: 0, provisional: 0, unreported: 0 };
    let finalized = 0n;
    let held = 0n;
    let containsProvisional = false;

    if (window) {
      for (const request of requests) {
        const { actualMicros, heldMicros } = contributionOf(request);
        if (request.cost_status === "final") {
          const started = request.started_at === null ? Number.NaN : new Date(request.started_at).getTime();
          if (Number.isNaN(started)) continue;
          if (started >= window.start.getTime() && started < window.end.getTime()) {
            finalized += actualMicros;
            counts.final += 1;
          }
          continue;
        }
        if (request.reservation_released_at !== null) {
          counts.released += 1;
          continue;
        }
        held += heldMicros;
        counts.held += 1;
        if (request.cost_status === "provisional") {
          counts.provisional += 1;
          containsProvisional = true;
        }
        if (request.cost_status === "unreported") counts.unreported += 1;
      }
    }

    const assessment = assessBudget({
      settings: {
        enabled: read("enabled"),
        monthly_budget_usd: read("monthly_budget_usd"),
        max_charge_per_run_usd: read("max_charge_per_run_usd"),
        billing_cycle_anchor: anchor,
        billing_cycle_length_months: length,
      },
      requests,
      liveRequests: [],
      maxConcurrent: read("max_concurrent"),
      now: new Date(),
    });

    const monthlyMicros = usdToMicros(typeof read("monthly_budget_usd") === "number"
      ? String(read("monthly_budget_usd")) : null);
    const committed = finalized + held;

    return {
      configured: window !== null && monthlyMicros !== null,
      window: window
        ? { start: window.start.toISOString(), end: window.end.toISOString(), index: window.index }
        : null,
      finalizedActualCostUsd: microsToUsd(finalized),
      heldReservationUsd: microsToUsd(held),
      committedUsd: microsToUsd(committed),
      monthlyBudgetUsd: monthlyMicros === null ? null : microsToUsd(monthlyMicros),
      availableUsd: monthlyMicros === null
        ? null
        : microsToUsd(monthlyMicros - committed > 0n ? monthlyMicros - committed : 0n),
      counts,
      containsProvisional,
      // Why the numbers may be unusable, in the server's own words. Admin-only.
      detail: assessment.ok ? null : assessment.detail,
    };
  });
}

// --- settings --------------------------------------------------------------------

/**
 * What each collector setting is allowed to be.
 *
 * Every rule below is read off the frozen consumer, not invented here:
 *
 * - `assessBudget` (C05) refuses `budget < 0`, `perRun <= 0`, and a
 *   `max_concurrent` that is not an integer of at least 1. So a monthly budget
 *   of zero is a legitimate way to stop spending and stays permitted, while a
 *   per-run ceiling of zero is not.
 * - `usdToMicros` (C05) refuses more than six decimals, because rounding money
 *   is how a budget drifts.
 * - `billingWindow` (C05) needs an anchor of the exact form YYYY-MM-DD and a
 *   length that is a whole number of months, at least one.
 * - `readCostSettings` (C10) already requires both cost windows to be finite
 *   and greater than zero.
 * - `startOnce` (C08) treats a falsy `run_timeout_minutes` as unset, and the
 *   scheduler (C12) requires `tick_batch` to be a positive integer.
 * - `lease_seconds` and `result_settle_seconds` become `make_interval(secs =>
 *   $n::int)`, so they must be whole seconds — and a lease of zero would expire
 *   the moment it is taken, which is the concurrency guarantee C08-C12 rest on.
 * - `adaptApifyItems` (C02) clamps the export to `MAX_BYTES`, and admission
 *   (C07) refuses a request above `ABSOLUTE_MAX_RECORDS`, so a cap beyond
 *   either is unreachable.
 * - `createApifyProvider` (C06) accepts `user~actor` and nothing else, and
 *   `buildAdLibraryUrl` (C02) requires an ISO 3166-1 alpha-2 country.
 *
 * Nothing here is tightened past what those consumers say.
 */

type Rule = { check: (value: unknown) => boolean; describe: string };

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Whole numbers only, at least one, and never past a cap the code already enforces. */
const positiveInteger = (max?: number): Rule => ({
  check: (value) => isNumber(value) && Number.isInteger(value) && value >= 1 && (max === undefined || value <= max),
  describe: max === undefined ? "a whole number of at least 1" : `a whole number between 1 and ${max}`,
});

/** A duration that may be fractional, but never zero: zero means "already expired". */
const positiveNumber: Rule = {
  check: (value) => isNumber(value) && value > 0,
  describe: "a number greater than 0",
};

/** Money, exact to six decimals. `min` is 0 where a consumer permits zero. */
const money = (min: 0 | "positive"): Rule => ({
  check: (value) => {
    if (!isNumber(value) || value < 0) return false;
    if (min === "positive" && value <= 0) return false;
    // The same parse the budget uses: more than six decimals cannot be held.
    return usdToMicros(value) !== null;
  },
  describe: min === 0
    ? "USD with at most six decimals, zero or more"
    : "USD with at most six decimals, greater than zero",
});

const nonBlankText: Rule = {
  check: (value) => typeof value === "string" && value.trim() !== "",
  describe: "text that is not blank",
};

const anchorDate: Rule = {
  check: (value) => {
    if (typeof value !== "string") return false;
    const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!parsed) return false;
    const month = Number(parsed[2]);
    const day = Number(parsed[3]);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31;
  },
  describe: "a date of the form YYYY-MM-DD",
};

const actorName: Rule = {
  // Exactly what the provider client accepts.
  check: (value) => typeof value === "string" && /^[\w.-]+~[\w.-]+$/.test(value.trim()),
  describe: "an actor named user~actor",
};

const countryList: Rule = {
  check: (value) => Array.isArray(value) && value.length > 0
    && value.every((entry) => typeof entry === "string" && /^[A-Z]{2}$/.test(entry)),
  describe: "a non-empty list of ISO 3166-1 alpha-2 country codes",
};

const boolean: Rule = {
  check: (value) => typeof value === "boolean",
  describe: "true or false",
};

/** Unset is a real value for everything C04 seeds as null: it fails closed. */
const nullable = (rule: Rule): Rule => ({
  check: (value) => value === null || rule.check(value),
  describe: `${rule.describe}, or null`,
});

/**
 * Every collector setting an admin may change, and what it may be changed to.
 *
 * An allowlist: a key that is not here cannot be written through this path, so
 * the settings API can never become a way to edit unrelated application state.
 * No secret is here either — tokens live in the environment, never in a row.
 */
export const COLLECTOR_SETTING_RULES: Record<string, Rule> = {
  // Money. Zero budget is permitted (C05 refuses only a negative one); a
  // per-run ceiling of zero is not, because C05 refuses `perRun <= 0`.
  monthly_budget_usd: nullable(money(0)),
  max_charge_per_run_usd: nullable(money("positive")),
  // No consumer yet: kept at the same money shape rather than given a meaning.
  estimated_usd_per_1000_ads: nullable(money(0)),

  billing_cycle_anchor: nullable(anchorDate),
  billing_cycle_length_months: nullable(positiveInteger()),

  max_records_per_run: nullable(positiveInteger(ABSOLUTE_MAX_RECORDS)),
  max_export_bytes: nullable(positiveInteger(MAX_BYTES)),
  run_timeout_minutes: nullable(positiveInteger()),

  reconcile_window_minutes: nullable(positiveNumber),
  reconcile_page_size: nullable(positiveInteger()),

  cost_settle_minutes: nullable(positiveNumber),
  cost_final_window_hours: nullable(positiveNumber),

  // Whole seconds: it becomes make_interval(secs => $n::int).
  result_settle_seconds: nullable(positiveInteger()),
  result_settle_window_minutes: nullable(positiveNumber),

  tick_batch: nullable(positiveInteger()),
  actor_build: nullable(nonBlankText),

  // Not nullable: the collector cannot decide anything without these.
  max_concurrent: positiveInteger(),
  // A lease of zero expires the instant it is taken, and two workers would then
  // claim the same request.
  lease_seconds: positiveInteger(),
  actor: actorName,
  countries: countryList,
  enabled: boolean,
};

export const COLLECTOR_SETTING_KEYS = Object.keys(COLLECTOR_SETTING_RULES);

export type SettingsPatchResult =
  | { ok: true; changed: string[] }
  | { ok: false; message: string };

/**
 * Changes collector settings, with every change audited.
 *
 * `collector.enabled` is in the allowlist because C16 has to flip it through an
 * audited path rather than by hand — but nothing else about activation belongs
 * here, and turning it on does not start anything by itself.
 */
export async function updateCollectorSettings(
  actor: Actor | null,
  patch: unknown,
): Promise<SettingsPatchResult> {
  const admin = requireAdmin(actor);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, message: "body must be a JSON object of settings" };
  }
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, message: "no settings given" };

  // Everything is judged before anything is written: one bad value in a patch
  // leaves the whole patch unwritten and unaudited.
  for (const [key, value] of entries) {
    const rule = COLLECTOR_SETTING_RULES[key];
    if (!rule) return { ok: false, message: `${key} is not a collector setting` };
    if (!rule.check(value)) return { ok: false, message: `${key} must be ${rule.describe}` };
  }

  return withTransaction(async (client) => {
    const changed: string[] = [];
    for (const [key, value] of entries) {
      const settingKey = `collector.${key}`;
      const { rows } = await client.query<{ value: unknown }>(
        "select value from public.app_settings where key = $1",
        [settingKey],
      );
      const before = rows[0]?.value ?? null;
      if (JSON.stringify(before) === JSON.stringify(value)) continue;

      await client.query(
        `insert into public.app_settings (key, value) values ($1, $2::jsonb)
         on conflict (key) do update set value = excluded.value`,
        [settingKey, JSON.stringify(value)],
      );
      await client.query(
        `insert into public.audit_logs (actor, action, entity_type, entity_id, before, after)
         values ($1, 'collector.settings_updated', 'app_setting', null, $2::jsonb, $3::jsonb)`,
        [admin.userId, JSON.stringify({ key: settingKey, value: before }), JSON.stringify({ key: settingKey, value })],
      );
      changed.push(settingKey);
    }
    return { ok: true, changed };
  });
}
