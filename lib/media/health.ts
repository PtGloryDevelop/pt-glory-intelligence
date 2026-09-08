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
