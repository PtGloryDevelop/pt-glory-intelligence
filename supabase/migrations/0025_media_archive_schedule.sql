-- Automatic archival: the database schedules its own drain.
--
-- Why here rather than a platform cron: the queue already lives in Postgres, and
-- Supabase ships pg_cron and pg_net, so scheduling next to the queue adds no new
-- provider and no assumption about which host runs the Next app or which plan it
-- is on. If the app moves, the schedule moves with the data.
--
-- pg_cron cannot run Node, and the drain has to fetch from a CDN and write to
-- object storage, so the job's whole job is to poke the app over HTTP. The
-- credentials for that live in Vault, never in this file and never in git.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Terminal vs retryable, recorded rather than re-derived
--
-- The claim query previously re-tried anything `failed` until attempt_count hit
-- the ceiling, which meant an expired source or a rejected host was fetched
-- three times to be told the same thing three times. The classification is known
-- at the moment of failure, so it is stored then.
alter table public.media_assets
  add column if not exists failure_retryable boolean;

-- Only retryable failures are eligible to be claimed again.
drop index if exists public.media_assets_queue_idx;
create index media_assets_queue_idx
  on public.media_assets (source_expires_at asc nulls last)
  where archive_status = 'pending'
     or (archive_status = 'failed' and failure_retryable);

-- ---------------------------------------------------------------------------
-- The scheduled call
--
-- SECURITY DEFINER because pg_cron runs it as the job owner and it must read
-- Vault. It takes no arguments and returns nothing useful — there is no way to
-- steer it at a different host — and EXECUTE is revoked from every application
-- role, so an authenticated session cannot use it as an SSRF primitive.
--
-- Absent configuration is a no-op, not an error: the migration must apply
-- cleanly to an environment where the secrets have not been created yet, and a
-- local database should never try to call a production URL.
create function public.run_media_archive_drain()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault, pg_temp
as $$
declare
  base_url text;
  token text;
begin
  select decrypted_secret into base_url
    from vault.decrypted_secrets where name = 'media_archive_url';
  select decrypted_secret into token
    from vault.decrypted_secrets where name = 'media_archive_token';

  if base_url is null or token is null then
    raise notice 'media archive drain skipped: configuration absent';
    return;
  end if;

  -- Fire and forget by design: pg_net queues the request and the response is of
  -- no interest to the scheduler. Progress is visible in media_assets, which is
  -- the actual record of what happened.
  perform net.http_post(
    url := base_url || '/api/media/archive/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || token
    ),
    body := jsonb_build_object('limit', 200),
    timeout_milliseconds := 120000
  );
end $$;

revoke all on function public.run_media_archive_drain() from public;
revoke all on function public.run_media_archive_drain() from anon;
revoke all on function public.run_media_archive_drain() from authenticated;

-- ---------------------------------------------------------------------------
-- The schedule
--
-- Every ten minutes. The window it is racing is the signed-URL lifetime, and the
-- shortest one measured in a fresh export was 28 hours — so ten minutes is
-- generous, while daily would not be. Bounded work per run; whatever is left
-- waits for the next tick.
do $$
begin
  perform cron.unschedule('media-archive-drain');
exception when others then
  null; -- not scheduled yet
end $$;

select cron.schedule(
  'media-archive-drain',
  '*/10 * * * *',
  $job$select public.run_media_archive_drain()$job$
);
