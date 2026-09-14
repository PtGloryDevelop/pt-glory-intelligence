-- Reverses 0041. The extensions belong to the media scheduler and remain.
do $$
begin
  perform cron.unschedule('collection-advance');
exception when others then
  null;
end $$;

drop function if exists public.run_collection_advance();
