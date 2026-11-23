import { withTransaction } from "../db/privileged.ts";

/**
 * Archive queue health.
 *
 * System operations, not a dataset metric — nothing here belongs on a business
 * dashboard. Its purpose is narrow: tell an operator whether the scheduler is
 * still doing its job, and how much time is left before it stops mattering.
 *
 * The number that matters is `expiringWithin24h`. Sources live about 105 hours
 * and the shortest observed in a fresh export had 28, so a queue that is merely
 * "large" is fine while a queue that is "expiring" is not.
 */

export type ArchiveHealth = {
  pending: number;
  archived: number;
  none: number;
  unusable: number;
  failedRetryable: number;
  failedTerminal: number;
  /** How long the oldest unfinished row has been waiting, in minutes. */
  oldestPendingAgeMinutes: number | null;
  /** Nearest source expiry still unarchived. */
  earliestExpiry: string | null;
  expiringWithin24h: number;
  /** True when work is waiting and nothing has been attempted recently. */
  lastAttemptAt: string | null;
};

export async function archiveHealth(): Promise<ArchiveHealth> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      pending: string; archived: string; none: string; unusable: string;
      failed_retryable: string; failed_terminal: string;
      oldest_pending_minutes: string | null; earliest_expiry: Date | null;
      expiring_24h: string; last_attempt_at: Date | null;
    }>(
      `select
         count(*) filter (where archive_status = 'pending')::text as pending,
         count(*) filter (where archive_status = 'archived')::text as archived,
         count(*) filter (where archive_status = 'none')::text as none,
         count(*) filter (where archive_status = 'unusable')::text as unusable,
         count(*) filter (
           where archive_status = 'failed' and failure_retryable and attempt_count < 3
         )::text as failed_retryable,
         count(*) filter (
           where archive_status = 'failed'
             and (failure_retryable is not true or attempt_count >= 3)
         )::text as failed_terminal,
         extract(epoch from (now() - min(created_at) filter (
           where archive_status in ('pending', 'failed')
         ))) / 60 as oldest_pending_minutes,
         min(source_expires_at) filter (
           where archive_status in ('pending', 'failed')
         ) as earliest_expiry,
         count(*) filter (
           where archive_status in ('pending', 'failed')
             and source_expires_at is not null
             and source_expires_at < now() + interval '24 hours'
         )::text as expiring_24h,
         max(last_attempt_at) as last_attempt_at
       from public.media_assets`,
    );

    const row = rows[0];
    return {
      pending: Number(row.pending),
      archived: Number(row.archived),
      none: Number(row.none),
      unusable: Number(row.unusable),
      failedRetryable: Number(row.failed_retryable),
      failedTerminal: Number(row.failed_terminal),
      oldestPendingAgeMinutes:
        row.oldest_pending_minutes === null ? null : Math.round(Number(row.oldest_pending_minutes)),
      earliestExpiry: row.earliest_expiry ? row.earliest_expiry.toISOString() : null,
      expiringWithin24h: Number(row.expiring_24h),
      lastAttemptAt: row.last_attempt_at ? row.last_attempt_at.toISOString() : null,
    };
  });
}

/**
 * Video reading queue health (spec 2026-11-23 §17): ad_video_readings by status, and what tells an
 * operator the VPS worker is behind. Operational only, like archiveHealth.
 */
export type VideoReadingHealth = {
  pending: number;
  ready: number;
  noVideo: number;
  expired: number;
  tooLarge: number;
  failed: number;
  /** Pending rows nobody has picked up (or retried) for 30 minutes: the worker is not running. */
  waitingOver30m: number;
  /** Nearest link expiry among pending rows. */
  earliestExpiry: string | null;
  expiringWithin24h: number;
  lastAttemptAt: string | null;
  /** Rows that reached a final status in the last 24 hours, and how many of them had expired. */
  stoppedLast24h: number;
  expiredLast24h: number;
};

/** More than this share of a day's finished rows expired: the worker is not keeping up (§17). */
export const EXPIRED_ALERT_SHARE = 0.05;

export async function videoReadingHealth(): Promise<VideoReadingHealth> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      pending: string; ready: string; no_video: string; expired: string; too_large: string; failed: string;
      waiting_30m: string; earliest_expiry: Date | null; expiring_24h: string; last_attempt_at: Date | null;
      stopped_24h: string; expired_24h: string;
    }>(
      `select
         count(*) filter (where status = 'pending')::text as pending,
         count(*) filter (where status = 'ready')::text as ready,
         count(*) filter (where status = 'no_video')::text as no_video,
         count(*) filter (where status = 'expired')::text as expired,
         count(*) filter (where status = 'too_large')::text as too_large,
         count(*) filter (where status = 'failed')::text as failed,
         count(*) filter (
           where status = 'pending' and coalesce(last_attempt_at, created_at) < now() - interval '30 minutes'
         )::text as waiting_30m,
         min(source_expires_at) filter (where status = 'pending') as earliest_expiry,
         count(*) filter (
           where status = 'pending' and source_expires_at < now() + interval '24 hours'
         )::text as expiring_24h,
         max(last_attempt_at) as last_attempt_at,
         count(*) filter (where status <> 'pending' and updated_at > now() - interval '24 hours')::text as stopped_24h,
         count(*) filter (where status = 'expired' and updated_at > now() - interval '24 hours')::text as expired_24h
       from public.ad_video_readings`,
    );
    const row = rows[0];
    return {
      pending: Number(row.pending), ready: Number(row.ready), noVideo: Number(row.no_video),
      expired: Number(row.expired), tooLarge: Number(row.too_large), failed: Number(row.failed),
      waitingOver30m: Number(row.waiting_30m),
      earliestExpiry: row.earliest_expiry ? row.earliest_expiry.toISOString() : null,
      expiringWithin24h: Number(row.expiring_24h),
      lastAttemptAt: row.last_attempt_at ? row.last_attempt_at.toISOString() : null,
      stoppedLast24h: Number(row.stopped_24h), expiredLast24h: Number(row.expired_24h),
    };
  });
}

/** The lines an operator acts on, worst first. Empty when the queue is healthy. */
export function videoReadingWarnings(health: VideoReadingHealth): string[] {
  const warnings: string[] = [];
  if (health.waitingOver30m > 0) {
    warnings.push(`${health.waitingOver30m} clip(s) pending for over 30 min with no attempt: is deploy/video-reader running on the VPS?`);
  }
  if (health.expiringWithin24h > 0) {
    warnings.push(`${health.expiringWithin24h} pending clip(s) expire within 24h · earliest ${health.earliestExpiry}`);
  }
  if (health.stoppedLast24h > 0 && health.expiredLast24h / health.stoppedLast24h > EXPIRED_ALERT_SHARE) {
    const share = (health.expiredLast24h / health.stoppedLast24h * 100).toFixed(1);
    warnings.push(`${health.expiredLast24h} of ${health.stoppedLast24h} clips finished in 24h had expired (${share}% > 5%): add passes or raise VIDEO_READER_BATCH`);
  }
  return warnings;
}
