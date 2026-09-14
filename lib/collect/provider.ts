/**
 * The collector's provider boundary (C06).
 *
 * One interface, three outcomes for a start: it started, it was refused with
 * evidence that no run exists, or the outcome is unknown.
 *
 * Raw provider JSON, provider URLs and the token stop at the client. The
 * normalized shapes below deliberately DO carry provider identifiers — run id,
 * dataset id, key-value store id — because reconciliation, the state machine
 * and admin diagnostics are built on them. They are internal evidence: keeping
 * them out of ordinary Viewer and Analyst DTOs is C03's rule, enforced in the
 * read layer.
 *
 * This file is pure types and pure helpers: no environment, no network. The
 * client lives in apify.ts and the deterministic double in mock.ts.
 */

/** Run states the provider documents, plus our own word for anything else. */
export const PROVIDER_RUN_STATUSES = [
  "READY", "RUNNING", "SUCCEEDED", "FAILED", "TIMING-OUT", "TIMED-OUT", "ABORTING", "ABORTED",
] as const;
export type ProviderRunStatus = (typeof PROVIDER_RUN_STATUSES)[number] | "UNKNOWN";

const TERMINAL: ReadonlySet<ProviderRunStatus> = new Set<ProviderRunStatus>([
  "SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED",
]);

/**
 * A status we do not recognise is never read as progress or as success: it is
 * UNKNOWN, non-terminal, and the state machine keeps waiting or asks a person.
 */
export function normalizeStatus(value: unknown): ProviderRunStatus {
  return typeof value === "string" && (PROVIDER_RUN_STATUSES as readonly string[]).includes(value)
    ? (value as ProviderRunStatus)
    : "UNKNOWN";
}

export const isTerminalStatus = (status: ProviderRunStatus): boolean => TERMINAL.has(status);

/**
 * The one spelling of a provider instant: UTC, ISO-8601, millisecond precision.
 *
 * Every timestamp leaving this boundary passes through here, so two instants
 * are the same instant exactly when their canonical text is equal. That test is
 * exact on purpose: C05 attributes a finalized cost by the charge-bearing start
 * timestamp, and a billing-cycle boundary can fall between two consecutive
 * milliseconds. A tolerance measured in seconds would quietly accept a start on
 * the far side of that boundary as "the same time".
 *
 * Anything unreadable is null, not a guess. Null is already how the collector
 * says "not known", and a start time nobody can parse must not become evidence.
 */
export function canonicalInstant(value: unknown): string | null {
  const ms = value instanceof Date ? value.getTime()
    : typeof value === "string" && value.trim() !== "" ? Date.parse(value)
    : Number.NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Provider cost evidence. Not accounting: these are the provider's own figures,
 * still moving, and only C05 decides what a budget may hold or call settled.
 */
export type ProviderUsageEvidence = {
  /** The provider's reported total, as exact decimal text. Never a float. */
  reportedTotalUsd: string | null;
  chargedItems: number | null;
  chargedStartEvents: number | null;
};

/** One run, as the rest of the system is allowed to see it. */
export type ProviderRun = {
  runId: string;
  status: ProviderRunStatus;
  terminal: boolean;
  /** Terminal AND successful. Nothing else counts as a complete run. */
  succeeded: boolean;
  datasetId: string | null;
  keyValueStoreId: string | null;
  /**
   * When the charge-bearing run began, as a canonical instant. This is the
   * evidence C05 attributes a finalized cost by; persisting it to the request's
   * started_at belongs to the state-machine ticket, not here.
   */
  startedAt: string | null;
  /** Canonical instant, like `startedAt`. */
  finishedAt: string | null;
  /** The build that actually ran, so a pinned build can be verified after the fact. */
  buildNumber: string | null;
  /** The ceiling the provider recorded, and the item cap it derived from it. */
  ceilingUsd: string | null;
  maxItems: number | null;
  usage: ProviderUsageEvidence;
};

export type StartRequest = {
  /** The Ad Library search URL the server built. */
  sourceUrl: string;
  /** PT Glory's own request id, carried into the run input for reconciliation. */
  runTag: string;
  /** The record cap the request was admitted with. */
  maxRecords: number;
  /**
   * The authoritative ceiling, already decided by admission. The client neither
   * computes it nor knows the actor's public price.
   */
  maxTotalChargeUsd: string;
  timeoutSeconds: number;
  /** Pinned build, from server settings. Never from user input. */
  build: string;
  memoryMbytes: number;
};

export type StartRefusal = "not_configured" | "rejected";

export type StartOutcome =
  /** A run exists and is identified. */
  | { outcome: "started"; run: ProviderRun }
  /**
   * Refused with evidence that no run was created: a request this client
   * rejected before sending, or a status proven to be refused before any actor
   * work. Nothing can have been charged.
   */
  | { outcome: "refused"; reason: StartRefusal; detail: string }
  /**
   * The default whenever a side effect is uncertain: transport failure, a 5xx,
   * an unreadable answer, a 2xx without a usable run identity, or any 4xx not
   * proven to reject before actor creation — 408, 409 and 429 among them. A run
   * may or may not exist, so nothing here may start a second one: the state
   * machine reconciles by runTag (provider_start_uncertain).
   */
  | { outcome: "unknown"; detail: string };

export type ReadFailure = "not_found" | "unavailable" | "malformed";
export type ProviderRead<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ReadFailure; detail: string };

export type DatasetMetadata = { itemCount: number; modifiedAt: string | null };
export type DatasetPage = { items: unknown[]; total: number | null };
/** The evidence reconciliation matches an uncertain start against. */
export type RunInputEvidence = { runTag: string | null; sourceUrl: string | null };

/**
 * Every provider operation the collector needs. Exactly one of them writes.
 */
export type CollectionProvider = {
  /** The one write. One POST per call, never retried inside the client. */
  startRun(request: StartRequest): Promise<StartOutcome>;
  readRun(runId: string): Promise<ProviderRead<ProviderRun>>;
  readRunInput(run: { keyValueStoreId: string }): Promise<ProviderRead<RunInputEvidence>>;
  readDatasetMetadata(datasetId: string): Promise<ProviderRead<DatasetMetadata>>;
  /** A one-item page, read for its pagination total: "ads found so far". */
  readDatasetItemTotal(datasetId: string): Promise<ProviderRead<number>>;
  readDatasetItems(datasetId: string, page: { offset: number; limit: number }): Promise<ProviderRead<DatasetPage>>;
  /** Reconciliation: the actor's own recent runs, newest first. */
  findRunsSince(since: Date, limit: number): Promise<ProviderRead<ProviderRun[]>>;
};

/**
 * Provider text, made safe to store as admin diagnostics.
 *
 * Credentials and URLs are removed rather than trusted: a provider is free to
 * echo a request back, and an error body is the easiest place for a token to
 * end up. The result is bounded, because an error field is not a log.
 */
export function scrubProviderMessage(value: unknown, limit = 300): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "") ?? "";
  const scrubbed = text
    .replace(/\bBearer\s+[\w.\-~+/]+=*/gi, "Bearer [redacted]")
    .replace(/\bapify_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/\b(token|api[_-]?key|secret|password|authorization)\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\s+/g, " ")
    .trim();
  return scrubbed.length > limit ? `${scrubbed.slice(0, limit - 1)}…` : scrubbed;
}
