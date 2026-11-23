// The video reading queue in ad_video_readings (migration 0080). Like the preview archive, the
// database is the queue: every state is committed, so an interrupted worker resumes. Every statement
// runs on the privileged pool, which bypasses RLS: this is server-side maintenance with no session.
import { withTransaction } from "../db/privileged.ts";
import { MAX_ATTEMPTS, queueStatusOf, selectVideo, type VideoField } from "./video-plan.ts";
import type { ClaimedReading, ReadResult } from "./video-reader.ts";

function query<T extends import("pg").QueryResultRow>(sql: string, params: unknown[] = []) {
  return withTransaction((client) => client.query<T>(sql, params));
}

/**
 * Queues every VIDEO observation of one collection run. Idempotent (one row per observation), so
 * the media step can be retried. A link already past its `oe` date is recorded as expired at once,
 * and an observation with no usable video entry as no_video: none of them reaches the worker.
 */
export async function enqueueVideoReadings(collectionRunId: string, now = new Date()): Promise<{ queued: number; expired: number; none: number }> {
  const { rows } = await query<{ id: string; display_format: string | null; media: unknown }>(
    `select id, display_format, media from public.ad_observations
      where collection_run_id = $1 and display_format = 'VIDEO'`,
    [collectionRunId],
  );
  if (rows.length === 0) return { queued: 0, expired: 0, none: 0 };
  const prepared = rows.map((row) => {
    const selection = selectVideo(row.display_format, row.media);
    const { status, reason } = queueStatusOf(selection, now);
    return {
      id: row.id, status, reason,
      field: selection.outcome === "candidate" ? selection.sourceField : null,
      expires: selection.outcome === "candidate" ? selection.expiresAt?.toISOString() ?? null : null,
      host: selection.outcome === "candidate" ? selection.host : null,
    };
  });
  await query(
    `insert into public.ad_video_readings (ad_observation_id, status, failure_reason, source_field, source_expires_at, source_host)
     select obs, status, reason, field, expires, host
       from unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::text[])
         as t(obs, status, reason, field, expires, host)
     on conflict (ad_observation_id) do nothing`,
    [prepared.map((r) => r.id), prepared.map((r) => r.status), prepared.map((r) => r.reason),
      prepared.map((r) => r.field), prepared.map((r) => r.expires), prepared.map((r) => r.host)],
  );
  const count = (status: string) => prepared.filter((r) => r.status === status).length;
  return { queued: count("pending"), expired: count("expired"), none: count("no_video") };
}

/** Queues the runs collected in the last `hours` (for links that may still be alive). */
export async function enqueueRecentRuns(hours: number): Promise<{ runs: number; queued: number; expired: number; none: number }> {
  const { rows } = await query<{ collection_run_id: string }>(
    `select distinct collection_run_id from public.ad_observations
      where display_format = 'VIDEO' and observed_at > now() - make_interval(hours => $1)`,
    [hours],
  );
  const total = { runs: rows.length, queued: 0, expired: 0, none: 0 };
  for (const row of rows) {
    const result = await enqueueVideoReadings(row.collection_run_id);
    total.queued += result.queued; total.expired += result.expired; total.none += result.none;
  }
  return total;
}

/**
 * Claims up to `limit` pending rows, the soonest to expire first. Claiming counts an attempt and
 * stamps it, so a row a crashed worker held comes back after `leaseMinutes`, and two workers never
 * take the same row (skip locked). The link is read from the observation, never stored in the queue.
 */
export async function claimVideoReadings(limit: number, leaseMinutes = 15): Promise<ClaimedReading[]> {
  const { rows } = await query<{ id: string; ad_observation_id: string; source_field: VideoField | null; attempt_count: number; video: Record<string, unknown> | null }>(
    `with picked as (
       select r.id from public.ad_video_readings r
        where r.status = 'pending'
          and (r.last_attempt_at is null or r.last_attempt_at < now() - make_interval(mins => $2))
        order by r.source_expires_at asc nulls last, r.created_at
        limit $1
        for update skip locked
     ), claimed as (
       update public.ad_video_readings r
          set attempt_count = r.attempt_count + 1, last_attempt_at = now(), updated_at = now()
         from picked where r.id = picked.id
       returning r.id, r.ad_observation_id, r.source_field, r.attempt_count
     )
     select c.id, c.ad_observation_id::text, c.source_field, c.attempt_count, o.media->'videos'->0 as video
       from claimed c join public.ad_observations o on o.id = c.ad_observation_id`,
    [limit, leaseMinutes],
  );
  return rows.map((row) => {
    const url = row.source_field ? row.video?.[row.source_field] : null;
    return { id: row.id, observationId: row.ad_observation_id, url: typeof url === "string" ? url : null, attempt: row.attempt_count };
  });
}

/** Writes what reading one row produced. A retry stays pending with its reason until attempts run out. */
export async function finishVideoReading(id: string, result: ReadResult, attempt: number): Promise<void> {
  if (result.status === "ready") {
    await query(
      `update public.ad_video_readings
          set status = 'ready', duration_ms = $2, processed_ms = $3, has_audio = $4, frames = $5::jsonb,
              audio_path = $6, audio_bytes = $7, audio_sha256 = $8,
              hook_audio_path = $9, hook_audio_bytes = $10, hook_audio_sha256 = $11,
              processed_at = now(), failure_reason = null, updated_at = now()
        where id = $1 and status = 'pending'`,
      [id, result.durationMs, result.processedMs, result.hasAudio, JSON.stringify(result.frames),
        result.audio?.path ?? null, result.audio?.bytes ?? null, result.audio?.sha256 ?? null,
        result.hook?.path ?? null, result.hook?.bytes ?? null, result.hook?.sha256 ?? null],
    );
    return;
  }
  const status = result.status === "retry" ? (attempt >= MAX_ATTEMPTS ? "failed" : "pending") : result.status;
  await query(
    `update public.ad_video_readings set status = $2, failure_reason = $3, updated_at = now()
      where id = $1 and status = 'pending'`,
    [id, status, result.reason],
  );
}
