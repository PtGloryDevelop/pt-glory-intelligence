-- A measured full-library search timed out under RLS. Cache the caller's role
-- once per statement and index one literal search field rather than OR scans.
drop policy owned_library_syncs_read on public.owned_library_syncs;
create policy owned_library_syncs_read on public.owned_library_syncs for select to authenticated
using ((select public.current_user_role()) in ('analyst','admin'));
drop policy owned_library_ads_read on public.owned_library_ads;
create policy owned_library_ads_read on public.owned_library_ads for select to authenticated
using ((select public.current_user_role()) in ('analyst','admin') and sync_id in (
  select id from public.owned_library_syncs where status='completed'
));
alter table public.owned_library_ads add column search_text text generated always as
  (ad_id || ' ' || ad_name || ' ' || campaign_name || ' ' || coalesce(page_name,'')) stored;
create extension if not exists pg_trgm with schema extensions;
do $$
declare extension_schema text;
begin
  select n.nspname into extension_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
  execute format('create index owned_library_ads_search on public.owned_library_ads using gin(search_text %I.gin_trgm_ops)',extension_schema);
end $$;
notify pgrst,'reload schema';
