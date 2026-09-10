-- The scheduled drain asks for less work per tick, so the tick can be observed.
--
-- FOUND IN PILOT, not in development. The frozen job asked for 200 assets per
-- run. Against the hosted deployment one asset takes roughly 1.6 seconds — fetch
-- from the CDN, transcode a poster, write to storage — so 200 of them is around
-- five minutes. pg_net gives up waiting at 120 seconds.
--
-- The work itself was fine: two consecutive scheduled ticks moved 611 pending
-- assets to 381 with nothing lost or stuck. What broke was the *evidence*. Every
-- tick carrying real load recorded `Timeout of 120000 ms reached` instead of an
-- HTTP status, which means net._http_response could no longer tell a healthy
-- run from a dead one — and that table is the only thing standing between us and
-- the C1.8 failure, where cron reported success while nothing was delivered.
--
-- So the batch is sized to finish inside the window that records the answer.
-- 50 assets is about 80 seconds, comfortably under 120, and at one tick every
-- ten minutes that is 300 an hour — far ahead of the ~34 hours a fresh signed
-- URL survives. A large first import simply takes a few hours of ticks, which
-- costs nothing and is visible the whole way.
--
-- Nothing else changes: same function, same schedule, same route, same security.
-- Only the number of items one tick claims.

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
    -- Sized to complete inside timeout_milliseconds below, so the response is
    -- recorded rather than abandoned. See the header comment.
    body := jsonb_build_object('limit', 50),
    timeout_milliseconds := 120000
  );
end $$;

revoke all on function public.run_media_archive_drain() from public;
revoke all on function public.run_media_archive_drain() from anon;
revoke all on function public.run_media_archive_drain() from authenticated;
