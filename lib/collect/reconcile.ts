import {
  canonicalInstant,
  type CollectionProvider,
  type ProviderRun,
} from "./provider.ts";

/** How far before the recorded attempt a matching run may have started. */
export const RECONCILE_SKEW_SECONDS = 120;

export type ReconcileRequest = {
  id: string;
  sourceUrl: string | null;
  startAttemptedAt: string | Date | null;
};

export type ReconcileLookup =
  | { kind: "match"; run: ProviderRun }
  | { kind: "none"; detail: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "unavailable"; detail: string };

/**
 * The one matching rule for an uncertain original start.
 *
 * This is deliberately read-only and bounded: list recent runs, then read the
 * INPUT record for each candidate and require both the deterministic runTag
 * and the request's source URL. Callers decide how the result changes state.
 */
export async function findOriginalStart(
  provider: CollectionProvider,
  request: ReconcileRequest,
  pageSize: number | null,
): Promise<ReconcileLookup> {
  const attempted = canonicalInstant(request.startAttemptedAt);
  const since = new Date(
    (attempted === null ? Date.now() : Date.parse(attempted))
      - RECONCILE_SKEW_SECONDS * 1_000,
  );
  const runs = await provider.findRunsSince(since, pageSize ?? 20);
  if (!runs.ok) return { kind: "unavailable", detail: `provider list unavailable: ${runs.detail}` };

  const matches: ProviderRun[] = [];
  for (const candidate of runs.value) {
    if (!candidate.keyValueStoreId) continue;
    const input = await provider.readRunInput({ keyValueStoreId: candidate.keyValueStoreId });
    if (!input.ok) continue;
    if (input.value.runTag === request.id && input.value.sourceUrl === request.sourceUrl) {
      matches.push(candidate);
    }
  }

  if (matches.length === 1) return { kind: "match", run: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", count: matches.length };
  return { kind: "none", detail: "no matching run found" };
}

/** Provider evidence that contradicts an identity already persisted. */
export function identityConflict(
  request: {
    provider_run_id: string | null;
    provider_dataset_id: string | null;
    provider_actor_build: string | null;
    started_at: string | null;
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
    if (persisted === null || reported === null || persisted !== reported) {
      return "provider start time does not match the start already recorded";
    }
  }
  return null;
}
