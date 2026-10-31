-- Restores owned_performance_page as it was before 0078 (the live body, renamed back) and drops the stored totals.
drop trigger if exists owned_ad_totals_publish on public.owned_library_syncs;
drop function if exists public.owned_ad_totals_on_publish();
drop function if exists public.owned_performance_page(uuid, date, date, text, text, text, text, text, integer);
alter function public.owned_performance_page_live(uuid, date, date, text, text, text, text, text, integer) rename to owned_performance_page;
grant execute on function public.owned_performance_page(uuid, date, date, text, text, text, text, text, integer) to authenticated, service_role;
drop function if exists public.owned_build_ad_totals(uuid);
drop table if exists public.owned_library_ad_totals;
drop table if exists public.owned_library_window;
notify pgrst, 'reload schema';
