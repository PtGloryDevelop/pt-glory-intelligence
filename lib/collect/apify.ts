import "server-only";
import {
  normalizeStatus, isTerminalStatus, scrubProviderMessage,
  type CollectionProvider, type DatasetMetadata, type DatasetPage, type ProviderRead,
  type ProviderRun, type RunInputEvidence, type StartOutcome, type StartRequest,
} from "./provider.ts";

/**
 * The Apify client. Server-only, and the only module that speaks the provider's
 * wire format.
 *
 * Raw provider JSON and provider URLs stop here. The normalized evidence that
 * leaves does carry provider identifiers — run id, dataset id, key-value store
 * id — because reconciliation, the state machine and admin diagnostics cannot
 * work without them. Keeping those identifiers out of ordinary Viewer and
 * Analyst DTOs is the read layer's job (C03), not something this module can
 * decide.
 *
 * The token is read from the server environment and sent as an `Authorization`
 * header. There is no query-string token path to fall back to. This module
 * persists nothing and never returns a token-bearing value; proving that
 * secrets are never stored belongs to the tickets that write rows.
 *
 * Every call is bounded by an explicit timeout. Nothing here waits for a run:
 * `waitForFinish` is deliberately not used, because a request that blocks for
 * minutes is exactly what the one-bounded-transition architecture forbids.
 */

const BASE = "https://api.apify.com/v2";

/**
 * The only status treated as proof that no run was created.
 *
 * Authentication is refused at the API edge before any actor work: C01-A
 * observed a request without the header answered `401 token-not-provided`
 * with nothing else happening. That evidence is about 401 alone — a 403 can
 * be an authorization decision taken anywhere, including after a run exists,
 * so it is not inferred from it. Every other 4xx — 400, 403, 404, 408, 409,
 * 429 — is ambiguous about whether a run now exists, so it fails safe to
 * UNKNOWN and the state machine reconciles by runTag rather than assuming.
 * A 403 may join this set only when its own error contract is proven.
 */
const DEFINITIVE_REFUSAL_STATUSES: ReadonlySet<number> = new Set([401]);
/** A start is a write: it gets the longer bound, but it is still bounded. */
export const START_TIMEOUT_MS = 20_000;
export const READ_TIMEOUT_MS = 15_000;
/** Dataset pages are read in bounded slices; the caller decides how many. */
export const MAX_ITEMS_PER_PAGE = 1_000;

export type ApifyConfig = {
  /** `user~actor`, from server settings. Never user input. */
  actor: string;
  /** Pinned build, from server settings. */
  build: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

type Json = Record<string, unknown>;

export function createApifyProvider(config: ApifyConfig): CollectionProvider {
  const token = config.token ?? process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not configured");
  if (!/^[\w.-]+~[\w.-]+$/.test(config.actor)) throw new Error("actor must be user~actor");
  const doFetch = config.fetchImpl ?? fetch;

  /** One request, header-authenticated and time-bounded. Never logs. */
  async function call(path: string, init: RequestInit & { timeoutMs: number }): Promise<
    { ok: true; status: number; body: unknown; headers: Headers }
    | { ok: false; kind: "http"; status: number; body: unknown }
    | { ok: false; kind: "transport"; detail: string }
  > {
    if (/[?&]token=/i.test(path)) throw new Error("the provider token never goes in a URL");
    const { timeoutMs, ...rest } = init;
    try {
      const response = await doFetch(`${BASE}${path}`, {
        ...rest,
        headers: { ...(rest.headers ?? {}), Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          // A body we cannot read is not a result. Fail closed rather than
          // guessing at half a response.
          return response.ok
            ? { ok: false, kind: "transport", detail: "unreadable provider response" }
            : { ok: false, kind: "http", status: response.status, body: null };
        }
      }
      if (!response.ok) return { ok: false, kind: "http", status: response.status, body };
      return { ok: true, status: response.status, body, headers: response.headers };
    } catch (error) {
      // Timeout, DNS, socket: the request may or may not have been received.
      return { ok: false, kind: "transport", detail: scrubProviderMessage((error as Error)?.name ?? "network failure") };
    }
  }

  const data = (body: unknown): Json | null => {
    const envelope = body as { data?: unknown } | null;
    return envelope && typeof envelope === "object" && envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Json) : null;
  };

  function toRun(raw: Json): ProviderRun | null {
    const runId = typeof raw.id === "string" ? raw.id : null;
    if (!runId) return null;
    const status = normalizeStatus(raw.status);
    const options = (raw.options ?? {}) as Json;
    const charged = (raw.chargedEventCounts ?? {}) as Record<string, unknown>;
    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const text = (value: unknown) => (typeof value === "string" ? value : null);
    return {
      runId,
      status,
      terminal: isTerminalStatus(status),
      succeeded: status === "SUCCEEDED",
      datasetId: text(raw.defaultDatasetId),
      keyValueStoreId: text(raw.defaultKeyValueStoreId),
      startedAt: text(raw.startedAt),
      finishedAt: text(raw.finishedAt),
      buildNumber: text(raw.buildNumber),
      // Exact decimal text, never a float: this is money evidence.
      ceilingUsd: number(options.maxTotalChargeUsd) === null ? null : String(options.maxTotalChargeUsd),
      maxItems: number(options.maxItems),
      usage: {
        reportedTotalUsd: number(raw.usageTotalUsd) === null ? null : String(raw.usageTotalUsd),
        chargedItems: number(charged["apify-default-dataset-item"]),
        chargedStartEvents: number(charged["apify-actor-start"]),
      },
    };
  }

  const readFailure = (result: { kind: "http"; status: number; body: unknown } | { kind: "transport"; detail: string }):
  { ok: false; reason: "not_found" | "unavailable"; detail: string } => (
    result.kind === "http" && result.status === 404
      ? { ok: false, reason: "not_found", detail: "provider has no such record" }
      : {
          ok: false,
          reason: "unavailable",
          detail: result.kind === "http"
            ? `http ${result.status}: ${scrubProviderMessage(errorMessage(result.body))}`
            : result.detail,
        }
  );

  return {
    async startRun(request: StartRequest): Promise<StartOutcome> {
      // Refused before the wire: nothing was sent, so nothing can have started.
      const invalid = validateStartRequest(request);
      if (invalid) return { outcome: "refused", reason: "rejected", detail: invalid };

      // Run options travel as query parameters; the token never does.
      const options = new URLSearchParams({
        build: request.build,
        timeout: String(request.timeoutSeconds),
        memory: String(request.memoryMbytes),
        maxTotalChargeUsd: request.maxTotalChargeUsd,
        // A provider-side restart would be a second charge nobody authorized.
        restartOnError: "false",
      });
      const input = {
        urls: [{ url: request.sourceUrl }],
        limitPerSource: request.maxRecords,
        scrapeAdDetails: false,
        // Ours, and the only way an uncertain start can be recognised later.
        runTag: request.runTag,
      };

      // Exactly one POST. There is no retry in this client, by construction.
      const result = await call(`/acts/${config.actor}/runs?${options}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        timeoutMs: START_TIMEOUT_MS,
      });

      if (result.ok) {
        const run = toRun(data(result.body) ?? {});
        // A 2xx we cannot read is not a start we can act on, and it is not a
        // refusal either: a run may be alive out there.
        return run
          ? { outcome: "started", run }
          : { outcome: "unknown", detail: "provider accepted the start but returned no run" };
      }
      if (result.kind === "http" && DEFINITIVE_REFUSAL_STATUSES.has(result.status)) {
        // Proven to be rejected before any actor work, so nothing was charged.
        return {
          outcome: "refused", reason: "not_configured",
          detail: `http ${result.status}: ${scrubProviderMessage(errorMessage(result.body))}`,
        };
      }
      return {
        outcome: "unknown",
        detail: result.kind === "http"
          ? `http ${result.status}: ${scrubProviderMessage(errorMessage(result.body))}`
          : result.detail,
      };
    },

    async readRun(runId: string): Promise<ProviderRead<ProviderRun>> {
      const result = await call(`/actor-runs/${encodeURIComponent(runId)}`, { timeoutMs: READ_TIMEOUT_MS });
      if (!result.ok) return readFailure(result);
      const run = toRun(data(result.body) ?? {});
      return run ? { ok: true, value: run } : { ok: false, reason: "malformed", detail: "run without an id" };
    },

    async readRunInput({ keyValueStoreId }): Promise<ProviderRead<RunInputEvidence>> {
      const result = await call(
        `/key-value-stores/${encodeURIComponent(keyValueStoreId)}/records/INPUT`,
        { timeoutMs: READ_TIMEOUT_MS },
      );
      if (!result.ok) return readFailure(result);
      const body = result.body as Json | null;
      if (!body || typeof body !== "object") {
        return { ok: false, reason: "malformed", detail: "input record is not an object" };
      }
      const urls = Array.isArray(body.urls) ? body.urls : [];
      const first = urls[0] as { url?: unknown } | string | undefined;
      const sourceUrl = typeof first === "string" ? first
        : typeof first?.url === "string" ? first.url : null;
      return {
        ok: true,
        value: { runTag: typeof body.runTag === "string" ? body.runTag : null, sourceUrl },
      };
    },

    async readDatasetMetadata(datasetId: string): Promise<ProviderRead<DatasetMetadata>> {
      const result = await call(`/datasets/${encodeURIComponent(datasetId)}`, { timeoutMs: READ_TIMEOUT_MS });
      if (!result.ok) return readFailure(result);
      const raw = data(result.body);
      const itemCount = raw && typeof raw.itemCount === "number" ? raw.itemCount : null;
      if (itemCount === null) return { ok: false, reason: "malformed", detail: "dataset without an item count" };
      return {
        ok: true,
        value: { itemCount, modifiedAt: typeof raw?.modifiedAt === "string" ? raw.modifiedAt : null },
      };
    },

    async readDatasetItemTotal(datasetId: string): Promise<ProviderRead<number>> {
      // One item, read for the pagination header alone.
      const result = await call(
        `/datasets/${encodeURIComponent(datasetId)}/items?offset=0&limit=1`,
        { timeoutMs: READ_TIMEOUT_MS },
      );
      if (!result.ok) return readFailure(result);
      const header = result.headers.get("x-apify-pagination-total");
      const total = header === null ? Number.NaN : Number(header);
      return Number.isInteger(total) && total >= 0
        ? { ok: true, value: total }
        : { ok: false, reason: "malformed", detail: "provider reported no item total" };
    },

    async readDatasetItems(datasetId: string, page): Promise<ProviderRead<DatasetPage>> {
      const limit = Math.min(Math.max(1, Math.trunc(page.limit)), MAX_ITEMS_PER_PAGE);
      const offset = Math.max(0, Math.trunc(page.offset));
      const result = await call(
        `/datasets/${encodeURIComponent(datasetId)}/items?offset=${offset}&limit=${limit}`,
        { timeoutMs: READ_TIMEOUT_MS },
      );
      if (!result.ok) return readFailure(result);
      if (!Array.isArray(result.body)) {
        return { ok: false, reason: "malformed", detail: "dataset items are not a list" };
      }
      const header = result.headers.get("x-apify-pagination-total");
      const total = header === null ? Number.NaN : Number(header);
      return {
        ok: true,
        value: { items: result.body, total: Number.isInteger(total) ? total : null },
      };
    },

    async findRunsSince(since: Date, limit: number): Promise<ProviderRead<ProviderRun[]>> {
      const bounded = Math.min(Math.max(1, Math.trunc(limit)), 100);
      const result = await call(
        `/acts/${config.actor}/runs?desc=1&limit=${bounded}`,
        { timeoutMs: READ_TIMEOUT_MS },
      );
      if (!result.ok) return readFailure(result);
      const items = (data(result.body)?.items ?? null) as unknown;
      if (!Array.isArray(items)) return { ok: false, reason: "malformed", detail: "run list is not a list" };
      const runs = items
        .map((item) => toRun((item ?? {}) as Json))
        .filter((run): run is ProviderRun => run !== null)
        .filter((run) => !run.startedAt || new Date(run.startedAt).getTime() >= since.getTime());
      return { ok: true, value: runs };
    },
  };
}

/**
 * What this client can judge without asking the provider. A request that fails
 * here never reaches the wire, which is the only refusal it can prove by itself.
 */
function validateStartRequest(request: StartRequest): string | null {
  if (!/^https:\/\/www\.facebook\.com\/ads\/library\//.test(request.sourceUrl)) {
    return "source URL is not an Ad Library search";
  }
  if (request.runTag.trim() === "") return "runTag is required for reconciliation";
  if (request.build.trim() === "") return "a pinned build is required";
  if (!/^\d+(\.\d{1,6})?$/.test(request.maxTotalChargeUsd)) return "ceiling is not an exact USD figure";
  if (!Number.isInteger(request.maxRecords) || request.maxRecords < 1) return "maxRecords must be a positive integer";
  if (!Number.isInteger(request.timeoutSeconds) || request.timeoutSeconds < 1) return "timeout must be a positive integer";
  if (!Number.isInteger(request.memoryMbytes) || request.memoryMbytes < 1) return "memory must be a positive integer";
  return null;
}

/** The provider's own message, before scrubbing. Never returned as-is. */
function errorMessage(body: unknown): string {
  const error = (body as { error?: { message?: unknown; type?: unknown } } | null)?.error;
  if (error && typeof error === "object") {
    const message = typeof error.message === "string" ? error.message : "";
    const type = typeof error.type === "string" ? error.type : "";
    return [type, message].filter(Boolean).join(": ");
  }
  return "";
}
