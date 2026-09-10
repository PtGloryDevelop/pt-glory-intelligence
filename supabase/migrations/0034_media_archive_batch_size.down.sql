-- Restores the original 200-asset batch.
--
-- Rolling this back returns the scheduler to a batch that cannot finish inside
-- pg_net's timeout on this deployment, so every tick with real work will again
-- record a timeout instead of an HTTP status. The archival itself keeps working;
-- the ability to prove it does not.

create or replace function public.run_media_archive_drain()
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
