import type { PoolClient } from "pg";
import { withTransaction } from "../db/privileged.ts";
import { buildAdLibraryUrl } from "./url.ts";
import {
  CONCURRENCY_SLOT_STATES, assessBudget, microsToUsd,
  type CollectorSettings, type RequestAccounting,
} from "./budget.ts";

/**
 * Admission (C07): the only way a collection request comes into existence.
 *
 * Everything that decides whether a collection may start — the settings, the
 * budget, the concurrency limit, the ceiling — is read and judged inside ONE
 * transaction that holds an advisory lock. Evaluating the budget in one
 * transaction and inserting the reservation in another would let two requests
 * see the same remaining budget and both be admitted; that is the race this
 * whole module exists to remove.
 *
 * It ends with a `queued` row and nothing else. No provider is contacted here:
 * starting the run belongs to the state machine, and this file deliberately
 * imports no provider code at all.
 */

/**
 * One lock for the whole collector, because one budget and one concurrency
 * pool are what competing admissions share.
 *
 * The key is `hashtext` of a fixed namespace literal, computed in SQL so every
 * database agrees on it. It contains no user text: a key built from a keyword
 * could be made to collide, or to miss, by whoever typed the keyword.
 */
export const ADMISSION_LOCK_NAMESPACE = "pt_glory.collector.admission";

/**
 * The hard ceiling on a single request, under the contract's MAX_RECORDS
 * (5,000) with room for the unresolved rows an export may also carry.
 */
export const ABSOLUTE_MAX_RECORDS = 4_970;

export type AdmissionInput = {
  /** The signed-in user. Authorization happens before this is called. */
  requestedBy: string;
  /** Generated once by the form, so a double submit cannot buy two runs. */
  requestKey: string;
  keyword: string;
  country: string;
  activeStatus: "active" | "all";
  maxRecords: number;
  categoryId: string;
  /** A label for the result. Omitted means "name it for me", not "leave it unnamed". */
  datasetName: string | null;
};

export type AdmissionRefusal = "not_configured" | "budget_reached" | "busy" | "invalid_request";

export type AdmissionResult =
  | {
      ok: true;
      requestId: string;
      /** True when this key had already been admitted: the same request, not a second one. */
      reused: boolean;
      /** The reservation held for this request, as exact USD text. */
      reservedUsd: string;
    }
  | {
      ok: false;
      refusal: AdmissionRefusal;
      /** Server-side only. User-facing wording stays neutral and says nothing about a provider. */
      detail: string;
    };

type SettingsRow = { key: string; value: unknown };

export async function admitCollection(
  input: AdmissionInput,
  options: { now?: Date } = {},
): Promise<AdmissionResult> {
  const now = options.now ?? new Date();
  return withTransaction(async (client) => admitInTransaction(client, input, now));
}

async function admitInTransaction(
  client: PoolClient,
  input: AdmissionInput,
  now: Date,
): Promise<AdmissionResult> {
  // 1. Serialize every competing admission. Transaction-scoped, so it is
  //    released by COMMIT or ROLLBACK and never leaks on a failure.
  await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [ADMISSION_LOCK_NAMESPACE]);

  // 2. The same submission twice is the same request — but only when it really
  //    is the same submission. Checked inside the lock, so two simultaneous
  //    retries cannot both insert.
  //
  //    A key is a claim, not proof: another person's key, or the same key
  //    carrying a different collection, fails closed rather than handing back
  //    somebody else's request or quietly collecting something else.
  const existing = await client.query<{
    id: string; requested_by: string; category_id: string;
    params: Record<string, unknown>; cost_reserved_usd: string | null;
  }>(
    `select id, requested_by, category_id, params, cost_reserved_usd
       from public.collection_requests where request_key = $1`,
    [input.requestKey],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.requested_by !== input.requestedBy) {
      // Says nothing about whose it is, and returns no id.
      return { ok: false, refusal: "invalid_request", detail: "request key is already in use" };
    }
    if (!sameCollection(row.params, row.category_id, input)) {
      return {
        ok: false, refusal: "invalid_request",
        detail: "request key was already used for a different collection",
      };
    }
    return {
      ok: true,
      requestId: row.id,
      reused: true,
      reservedUsd: row.cost_reserved_usd ?? "0.000000",
    };
  }

  // 3. Settings, read under the lock: a change mid-admission cannot split the
  //    decision across two different configurations.
  const settingsRows = await client.query<SettingsRow>(
    "select key, value from public.app_settings where key like 'collector.%'",
  );
  const settings = new Map(settingsRows.rows.map((row) => [row.key, row.value]));
  const read = (name: string) => settings.get(`collector.${name}`) ?? null;

  const budgetSettings: CollectorSettings = {
    enabled: read("enabled"),
    monthly_budget_usd: read("monthly_budget_usd"),
    max_charge_per_run_usd: read("max_charge_per_run_usd"),
    billing_cycle_anchor: read("billing_cycle_anchor"),
    billing_cycle_length_months: read("billing_cycle_length_months"),
  };

  // Settings admission owns beyond the budget arithmetic. Unset means unset:
  // nothing here invents a default.
  const recordCap = read("max_records_per_run");
  const actorBuild = read("actor_build");
  const countries = read("countries");
  const missing = [
    typeof recordCap !== "number" && "max_records_per_run",
    typeof actorBuild !== "string" && "actor_build",
    !Array.isArray(countries) && "countries",
  ].filter((name): name is string => typeof name === "string");
  if (missing.length > 0) {
    return { ok: false, refusal: "not_configured", detail: `unset: ${missing.join(", ")}` };
  }

  // 4. The request itself, judged against those settings.
  const invalid = validate(input, {
    recordCap: recordCap as number,
    countries: (countries as unknown[]).filter((c): c is string => typeof c === "string"),
  });
  if (invalid) return { ok: false, refusal: "invalid_request", detail: invalid };

  const category = await client.query(
    "select 1 from public.categories where id = $1 and deleted_at is null",
    [input.categoryId],
  );
  if (category.rowCount === 0) {
    return { ok: false, refusal: "invalid_request", detail: "category does not exist" };
  }

  // 5. The accounting inputs C05 needs: everything still holding a reservation,
  //    whichever cycle it began in, plus every settled cost. A settled cost
  //    with no start is included on purpose — C05 fails closed on it rather
  //    than letting it vanish from the commitment.
  const accounting = await client.query<RequestAccounting>(
    `select status, cost_status, cost_reserved_usd, cost_provisional_usd, cost_final_usd,
            reservation_released_at, started_at
       from public.collection_requests
      where (cost_status <> 'final' and reservation_released_at is null)
         or cost_status = 'final'`,
  );
  const live = await client.query<{ status: string }>(
    "select status from public.collection_requests where status = any($1::text[])",
    [[...CONCURRENCY_SLOT_STATES]],
  );

  // 6. One judgement, from the frozen arithmetic. Nothing is recomputed here.
  const assessment = assessBudget({
    settings: budgetSettings,
    requests: accounting.rows,
    liveRequests: live.rows,
    maxConcurrent: read("max_concurrent"),
    now,
  });
  if (!assessment.ok) return { ok: false, refusal: assessment.refusal, detail: assessment.detail };

  // 7. The reservation is the authorized ceiling, and it is written in the same
  //    transaction that decided it.
  const reservedUsd = microsToUsd(assessment.runCeilingMicros);
  const sourceUrl = buildAdLibraryUrl({
    country: input.country, query: normalizeKeyword(input.keyword), activeStatus: input.activeStatus,
  });
  const params = canonicalParams(input);
  const datasetName = input.datasetName?.trim() || autoDatasetName(params.keyword, input.country, now);

  const inserted = await client.query<{ id: string }>(
    `insert into public.collection_requests
       (requested_by, request_key, params, category_id, dataset_name, source_url,
        cost_status, cost_reserved_usd, next_check_at)
     values ($1, $2, $3::jsonb, $4, $5, $6, 'reserved', $7, now())
     returning id`,
    [
      input.requestedBy, input.requestKey, JSON.stringify(params), input.categoryId,
      datasetName, sourceUrl, reservedUsd,
    ],
  );
  const requestId = inserted.rows[0].id;

  // 8. The audit row carries what was asked for and what was held. No provider
  //    identity exists yet, and none would belong here if it did.
  await client.query(
    `insert into public.audit_logs (actor, action, entity_type, entity_id, after)
     values ($1, 'collection.start', 'collection_request', $2, $3::jsonb)`,
    [input.requestedBy, requestId, JSON.stringify({ ...params, reserved_usd: reservedUsd })],
  );

  return { ok: true, requestId, reused: false, reservedUsd };
}

/**
 * The name the result will carry, decided here and never again.
 *
 * It exists before the provider is contacted, so the import step has nothing to
 * invent at the end of a collection — a name chosen later could differ between
 * an import and its retry. A caller's own name is kept exactly as given.
 *
 * The date is the admission date in Bangkok (UTC+7, no DST), because that is
 * the day the person asking is actually having.
 */
export function autoDatasetName(keyword: string, country: string, now: Date): string {
  const bangkokDay = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `${keyword} · ${country} · ${bangkokDay}`.slice(0, 200);
}

/**
 * The fields that define the paid collection. A dataset name is a label on the
 * result, so changing it is not a different collection; everything here is.
 */
function canonicalParams(input: AdmissionInput) {
  return {
    keyword: normalizeKeyword(input.keyword),
    country: input.country,
    active_status: input.activeStatus,
    max_records: input.maxRecords,
  };
}

/** One spelling of a keyword, so the same submission compares equal to itself. */
function normalizeKeyword(keyword: string): string {
  return keyword.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function sameCollection(
  storedParams: Record<string, unknown>,
  storedCategoryId: string,
  input: AdmissionInput,
): boolean {
  if (storedCategoryId !== input.categoryId) return false;
  const wanted = canonicalParams(input);
  return storedParams.keyword === wanted.keyword
    && storedParams.country === wanted.country
    && storedParams.active_status === wanted.active_status
    && storedParams.max_records === wanted.max_records;
}

/** What the server can judge about the request before it costs anything. */
function validate(
  input: AdmissionInput,
  limits: { recordCap: number; countries: string[] },
): string | null {
  if (input.keyword.trim() === "") return "keyword is required";
  if (input.keyword.trim().length > 200) return "keyword is too long";
  if (!limits.countries.includes(input.country)) return `country ${input.country} is not collected`;
  if (input.activeStatus !== "active" && input.activeStatus !== "all") return "active status is not recognised";
  if (!Number.isInteger(input.maxRecords) || input.maxRecords < 1) return "maxRecords must be a positive integer";
  if (input.maxRecords > limits.recordCap) return `maxRecords exceeds the configured cap (${limits.recordCap})`;
  if (input.maxRecords > ABSOLUTE_MAX_RECORDS) return `maxRecords exceeds ${ABSOLUTE_MAX_RECORDS}`;
  if (input.datasetName !== null && input.datasetName.trim().length > 200) return "dataset name is too long";
  if (input.requestKey.trim() === "") return "requestKey is required";
  return null;
}
