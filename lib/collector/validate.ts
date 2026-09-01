import {
  AD_KEYS, FILE_KEYS, MAX_BYTES, MAX_RECORDS, REQUIRED_AD_KEYS, REQUIRED_FILE_KEYS,
  SCOPE_KEYS, SOURCE_KEYS, isForbiddenKey, isKnownAdKey,
} from "./contract.ts";
import { computeCounts, diffCounts, readReportedCounts } from "./counts.ts";
import { COLLECTION_METHODS, type RunCounts } from "../domain/types.ts";

/**
 * File-level validation. Runs before anything is normalized or written.
 *
 * Fails closed: an unfamiliar field, an unknown collection method or a count we
 * cannot reproduce rejects the whole file. Nothing is stripped here — stripping
 * before validation would hide exactly the contract drift this is meant to
 * catch, so the normalizer's allowlist is a second layer, not the first.
 */

export const FILE_REJECT_REASONS = [
  "malformed_json",
  "schema_mismatch",
  "unknown_field",
  "unsupported_collection_method",
  "size_limit_exceeded",
  "count_mismatch",
] as const;
export type FileRejectReason = (typeof FILE_REJECT_REASONS)[number];

export type ValidationFailure = { reason: FileRejectReason; detail: string };

export type ValidationSuccess = {
  ok: true;
  file: CollectorExport;
  computed: RunCounts;
  reported: Partial<RunCounts>;
};

export type ValidationResult = ValidationSuccess | ({ ok: false } & ValidationFailure);

export type CollectorExport = {
  schema_version: string;
  generated_at: string;
  source: { product?: string; collection_method?: string; url?: string; completeness_claim?: string };
  scope?: Record<string, unknown>;
  stop_reason?: string | null;
  quality_summary?: Record<string, unknown> | null;
  ads: Record<string, unknown>[];
  unresolved_ads: Record<string, unknown>[];
  [key: string]: unknown;
};

const fail = (reason: FileRejectReason, detail: string): ValidationResult => ({
  ok: false, reason, detail,
});

/** Parses raw text, then validates. Separate entry point so JSON errors are typed. */
export function validateRaw(text: string): ValidationResult {
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
    return fail("size_limit_exceeded", `file exceeds ${MAX_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return fail("malformed_json", (error as Error).message);
  }
  return validate(parsed);
}

export function validate(input: unknown): ValidationResult {
  if (!isRecord(input)) return fail("schema_mismatch", "export must be a JSON object");

  for (const key of REQUIRED_FILE_KEYS) {
    if (!(key in input)) return fail("schema_mismatch", `missing required file field: ${key}`);
  }
  for (const key of Object.keys(input)) {
    if (!(FILE_KEYS as readonly string[]).includes(key)) {
      return fail("unknown_field", `unknown file field: ${key}`);
    }
  }

  if (typeof input.generated_at !== "string" || Number.isNaN(Date.parse(input.generated_at))) {
    return fail("schema_mismatch", "generated_at must be an ISO timestamp");
  }
  if (!Array.isArray(input.ads) || !Array.isArray(input.unresolved_ads)) {
    return fail("schema_mismatch", "ads and unresolved_ads must be arrays");
  }

  if (!isRecord(input.source)) return fail("schema_mismatch", "source must be an object");
  for (const key of Object.keys(input.source)) {
    if (!(SOURCE_KEYS as readonly string[]).includes(key)) {
      return fail("unknown_field", `unknown source field: ${key}`);
    }
  }
  const method = input.source.collection_method;
  if (typeof method !== "string" || !(COLLECTION_METHODS as readonly string[]).includes(method)) {
    return fail("unsupported_collection_method", `collection_method: ${String(method)}`);
  }

  if (input.scope !== undefined) {
    if (!isRecord(input.scope)) return fail("schema_mismatch", "scope must be an object");
    for (const key of Object.keys(input.scope)) {
      if (!(SCOPE_KEYS as readonly string[]).includes(key)) {
        return fail("unknown_field", `unknown scope field: ${key}`);
      }
    }
  }

  const rows = [...input.ads, ...input.unresolved_ads];
  if (rows.length > MAX_RECORDS) {
    return fail("size_limit_exceeded", `${rows.length} records exceeds ${MAX_RECORDS}`);
  }

  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) return fail("schema_mismatch", `row ${index} is not an object`);
    for (const key of Object.keys(row)) {
      if (isForbiddenKey(key)) {
        return fail("unknown_field", `row ${index} carries forbidden metric: ${key}`);
      }
      if (!isKnownAdKey(key)) {
        return fail("unknown_field", `row ${index} has unknown field: ${key}`);
      }
    }
  }

  // Required ad fields apply to resolved ads only; unresolved rows are defined
  // by the absence of ad_archive_id and are quarantined rather than imported.
  for (const [index, row] of (input.ads as Record<string, unknown>[]).entries()) {
    for (const key of REQUIRED_AD_KEYS) {
      if (row[key] === undefined || row[key] === null || row[key] === "") {
        return fail("schema_mismatch", `ads[${index}] missing required field: ${key}`);
      }
    }
  }

  const computed = computeCounts(input as { ads: never[]; unresolved_ads: never[] });
  const reported = readReportedCounts(input);
  const mismatches = diffCounts(reported, computed);
  if (mismatches.length > 0) {
    const detail = mismatches
      .map((m) => `${m.field}: reported ${m.reported} / computed ${m.computed}`)
      .join("; ");
    return fail("count_mismatch", detail);
  }

  return { ok: true, file: input as unknown as CollectorExport, computed, reported };
}

/** Exposed so tests can assert the contract lists stay in sync. */
export const KNOWN_AD_KEYS = AD_KEYS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
