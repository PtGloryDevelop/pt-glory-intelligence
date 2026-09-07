import type { PoolClient } from "pg";
import { withTransaction } from "../db/privileged.ts";
import { fetchPreview, isTerminal, type FailureReason } from "./fetch.ts";
import { selectPreview, type PreviewSelection } from "./select.ts";
import { previewPath, type ArchiveStore } from "./store.ts";

/**
 * The archival pipeline: enqueue, then drain.
 *
 * The database is the queue. Not a promise left dangling after the response, not
 * a timer — those die with the process and take the pending work with them.
 * Every row's state is committed, so an interrupted run resumes rather than
 * silently losing four days of retrievable creatives.
 *
 * Nothing here runs inside the canonical import transaction. A CDN outage must
 * never roll back a dataset that imported correctly.
 */

/**
 * Every statement here runs on the privileged pool, which bypasses RLS. The
 * archival path has no user session — it is server-side maintenance — so this is
 * the same boundary the import writer uses, reached through the same helper
 * rather than by widening the privileged module's surface.
 */
function query<T extends import("pg").QueryResultRow>(sql: string, params: unknown[] = []) {
  return withTransaction((client) => client.query<T>(sql, params));
}

export type ArchiveStats = {
  queued: number;
  archived: number;
  none: number;
  unusable: number;
  failed: number;
  retryableRemaining: number;
  expiredBeforeArchive: number;
  bytesStored: number;
  durationMs: number;
};

/** Column values for one queued row, derived from the selection outcome. */
const kindOf = (s: PreviewSelection) => (s.outcome === "candidate" ? s.kind : null);
const fieldOf = (s: PreviewSelection) => (s.outcome === "candidate" ? s.sourceField : null);
const urlOf = (s: PreviewSelection) => (s.outcome === "candidate" ? s.url : null);
const hostOf = (s: PreviewSelection) => (s.outcome === "candidate" ? s.host : null);
const expiryOf = (s: PreviewSelection) =>
  s.outcome === "candidate" && s.expiresAt ? s.expiresAt.toISOString() : null;
const statusOf = (s: PreviewSelection) =>
  s.outcome === "candidate" ? "pending" : s.outcome === "none" ? "none" : "unusable";

/** A failed row is retried at most this many times before it is left alone. */
export const MAX_ATTEMPTS = 3;

/**
 * Records archive state for every observation in a run.
 *
 * Runs AFTER the import transaction has committed, on its own connection. It
 * only ever inserts — `on conflict do nothing` — so re-running it cannot reset a
 * row that has already been archived.
 */
export async function enqueueRun(collectionRunId: string): Promise<{ queued: number }> {
  const { rows } = await query<{
    id: string; display_format: string | null; media: unknown;
  }>(
    `select id, display_format, media
       from public.ad_observations
      where collection_run_id = $1`,
    [collectionRunId],
  );

  if (rows.length === 0) return { queued: 0 };

  // Selection happens here, once, so the worker never has to inspect raw media
  // JSON and the queue already knows which rows have nothing to fetch.
  const prepared: { observationId: string; selection: PreviewSelection }[] = rows.map((row) => ({
    observationId: row.id,
    selection: selectPreview(row.display_format, row.media as never),
  }));

  await query(
    `insert into public.media_assets (
       ad_observation_id, asset_role, source_media_kind, source_field,
       source_url, source_expires_at, source_host, archive_status
     )
     select obs, 'preview', kind, field, url, expires, host, status
       from unnest($1::bigint[], $2::text[], $3::text[], $4::text[],
                   $5::timestamptz[], $6::text[], $7::text[])
         as t(obs, kind, field, url, expires, host, status)
     on conflict (ad_observation_id, asset_role) do nothing`,
    [
      prepared.map((row) => row.observationId),
      prepared.map((row) => kindOf(row.selection)),
      prepared.map((row) => fieldOf(row.selection)),
      prepared.map((row) => urlOf(row.selection)),
      prepared.map((row) => expiryOf(row.selection)),
      prepared.map((row) => hostOf(row.selection)),
      prepared.map((row) => statusOf(row.selection)),
    ],
  );

  return { queued: prepared.filter((row) => row.selection.outcome === "candidate").length };
}

type QueueRow = {
  id: string;
  ad_observation_id: string;
  collection_run_id: string;
  source_url: string;
  source_expires_at: Date | null;
  attempt_count: number;
};

/**
 * Processes up to `limit` rows, soonest-to-expire first.
 *
 * Bounded by design: a request-scoped invocation must finish in a predictable
 * time, and whatever it does not reach stays committed as pending for the next
 * call. Safe to run repeatedly and concurrently — `for update skip locked` means
 * two drains divide the work instead of fighting over it.
 */
export async function drainArchiveQueue(
  store: ArchiveStore,
  options: { limit?: number; collectionRunId?: string; now?: Date } = {},
): Promise<ArchiveStats> {
  const started = Date.now();
  const limit = options.limit ?? 200;
  const now = options.now ?? new Date();

  const stats: ArchiveStats = {
    queued: 0, archived: 0, none: 0, unusable: 0, failed: 0,
    retryableRemaining: 0, expiredBeforeArchive: 0, bytesStored: 0, durationMs: 0,
  };

  const claimed = await claim(limit, options.collectionRunId);
  stats.queued = claimed.length;

  for (const row of claimed) {
    // Cheap terminal check before spending a request. The measured spread of
    // source lifetimes is wide — one fresh export held a URL with 28 hours left
    // against a median of 102 — so some rows really do die in the queue.
    if (row.source_expires_at && row.source_expires_at.getTime() <= now.getTime()) {
      await recordFailure(row, "source_expired");
      stats.failed += 1;
      stats.expiredBeforeArchive += 1;
      continue;
    }

    const result = await fetchPreview(row.source_url, { expiresAt: row.source_expires_at });

    if (!result.ok) {
      await recordFailure(row, result.reason);
      stats.failed += 1;
      if (result.reason === "source_expired") stats.expiredBeforeArchive += 1;
      if (!isTerminal(result.reason) && row.attempt_count + 1 < MAX_ATTEMPTS) {
        stats.retryableRemaining += 1;
      }
      continue;
    }

    const path = previewPath(row.collection_run_id, row.ad_observation_id, result.mimeType);
    try {
      // Upload first, then commit the status. If the process dies in between,
      // the row stays pending and the next run overwrites the same key with the
      // same bytes — convergent, not duplicated.
      await store.putPreview(path, result.bytes, result.mimeType);
    } catch {
      await recordFailure(row, "storage_upload_failed");
      stats.failed += 1;
      if (row.attempt_count + 1 < MAX_ATTEMPTS) stats.retryableRemaining += 1;
      continue;
    }

    await query(
      `update public.media_assets
          set archive_status = 'archived', storage_path = $2, mime_type = $3,
              byte_size = $4, sha256 = $5, archived_at = now(),
              failure_reason = null, updated_at = now()
        where id = $1`,
      [row.id, path, result.mimeType, result.byteSize, result.sha256],
    );
    stats.archived += 1;
    stats.bytesStored += result.byteSize;
  }

  const tallies = await query<{ archive_status: string; n: string }>(
    options.collectionRunId
      ? `select m.archive_status, count(*)::text as n
           from public.media_assets m
           join public.ad_observations o on o.id = m.ad_observation_id
          where o.collection_run_id = $1
          group by 1`
      : `select archive_status, count(*)::text as n from public.media_assets group by 1`,
    options.collectionRunId ? [options.collectionRunId] : [],
  );
  for (const row of tallies.rows) {
    if (row.archive_status === "none") stats.none = Number(row.n);
    if (row.archive_status === "unusable") stats.unusable = Number(row.n);
  }

  stats.durationMs = Date.now() - started;
  return stats;
}

/**
 * Takes a batch of work under a row lock.
 *
 * `skip locked` keeps concurrent drains from processing the same row twice, and
 * the attempt counter is bumped inside the same transaction so a crash mid-fetch
 * still counts as an attempt rather than looping forever.
 */
async function claim(limit: number, collectionRunId?: string): Promise<QueueRow[]> {
  return withTransaction(async (client: PoolClient) => {
    const { rows } = await client.query<QueueRow>(
      `with candidates as (
         select m.id
           from public.media_assets m
           join public.ad_observations o on o.id = m.ad_observation_id
          where m.source_url is not null
            and (m.archive_status = 'pending'
                 or (m.archive_status = 'failed' and m.attempt_count < $2))
            and ($3::uuid is null or o.collection_run_id = $3)
          order by m.source_expires_at asc nulls last
          limit $1
          for update of m skip locked
       )
       update public.media_assets m
          set attempt_count = m.attempt_count + 1,
              last_attempt_at = now(),
              updated_at = now()
         from candidates c
        where m.id = c.id
       returning m.id, m.ad_observation_id, m.source_url, m.source_expires_at,
                 m.attempt_count,
                 (select o.collection_run_id from public.ad_observations o
                   where o.id = m.ad_observation_id) as collection_run_id`,
      [limit, MAX_ATTEMPTS, collectionRunId ?? null],
    );
    return rows;
  });
}

/** Machine-readable reason only. A signed URL never reaches this column. */
async function recordFailure(row: QueueRow, reason: FailureReason | "storage_upload_failed") {
  await query(
    `update public.media_assets
        set archive_status = 'failed', failure_reason = $2, updated_at = now()
      where id = $1`,
    [row.id, reason],
  );
}
