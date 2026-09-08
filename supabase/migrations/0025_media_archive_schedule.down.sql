-- Removes the schedule and the function. Leaves pg_cron and pg_net installed:
-- dropping an extension another feature may rely on is a bigger blast radius
-- than this migration is entitled to. Leaves the failure_retryable column too,
-- since dropping it would discard classification for rows already recorded.
do $$
begin
  perform cron.unschedule('media-archive-drain');
exception when others then
  null;
end $$;

drop function if exists public.run_media_archive_drain();
