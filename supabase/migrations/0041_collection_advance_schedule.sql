-- Phase 15 C12: bounded collection progress, driven by pg_cron.
--
-- The database only wakes the machine. It never starts an actor itself: the
-- route claims at most collector.tick_batch rows and advances one transition
-- per row after answering 202. Vault is deliberately empty in local setups,
-- making this function a no-op until an environment is configured explicitly.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function public.run_collection_advance()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault, pg_temp
as $$
declare
  base_url text;
  token text;
  tick_batch integer;
  has_work boolean;
begin
  select decrypted_secret into base_url
    from vault.decrypted_secrets where name = 'collection_advance_url';
  select decrypted_secret into token
    from vault.decrypted_secrets where name = 'collection_advance_token';

  -- JSON settings are owner-controlled. Only a positive integer is a usable
  -- batch; the cap keeps a malformed setting from creating an unbounded tick.
  select case
           when jsonb_typeof(value) = 'number'
            and (value #>> '{}') ~ '^[1-9][0-9]*$'
           then least((value #>> '{}')::numeric, 100)::integer
           else null
         end
    into tick_batch
    from public.app_settings
   where key = 'collector.tick_batch';

  if base_url is null or token is null or tick_batch is null then
    raise notice 'collection advance skipped: configuration absent';
    return;
  end if;

  select exists (
    select 1
      from public.collection_requests r
     where (
       (
         (
           r.status in ('queued', 'starting', 'provider_start_uncertain', 'running', 'settling', 'importing')
           and r.requires_admin = false
         )
         or (r.status = 'succeeded' and r.media_enqueued_at is null)
       )
       and (r.lease_expires_at is null or r.lease_expires_at < now())
       and (r.next_check_at is null or r.next_check_at <= now())
     )
     or (
       r.provider_run_id is not null
       and r.cost_status in ('reserved', 'provisional', 'unreported')
       and r.cost_next_check_at is not null
       and r.cost_next_check_at <= now()
     )
  ) into has_work;

  -- In particular, an empty queue must not create a paid or network request.
  if not has_work then
    raise notice 'collection advance skipped: no work due';
    return;
  end if;

  -- Fire and forget. The app route owns all provider calls and commits; pg_net
  -- only wakes it with a machine credential stored in Vault.
  perform net.http_post(
    url := base_url || '/api/collections/advance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || token
    ),
    body := jsonb_build_object('limit', tick_batch),
    timeout_milliseconds := 120000
  );
end $$;

revoke all on function public.run_collection_advance() from public;
revoke all on function public.run_collection_advance() from anon;
revoke all on function public.run_collection_advance() from authenticated;

do $$
begin
  perform cron.unschedule('collection-advance');
exception when others then
  null; -- not scheduled yet
end $$;

select cron.schedule(
  'collection-advance',
  '* * * * *',
  $job$select public.run_collection_advance()$job$
);
