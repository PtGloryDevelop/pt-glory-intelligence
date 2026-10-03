drop function if exists public.owned_performance_page(uuid,date,date,text,text,text,text,text,integer);
drop table if exists public.owned_library_daily;
alter table public.owned_library_syncs drop constraint if exists owned_daily_coverage;
alter table public.owned_library_syncs drop column if exists daily_ready,drop column if exists daily_from,drop column if exists daily_to;
notify pgrst,'reload schema';
