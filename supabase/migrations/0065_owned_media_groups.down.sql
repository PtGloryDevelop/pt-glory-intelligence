-- Removes creative grouping (0065). owned_performance_page is untouched by 0065.
drop function if exists public.owned_media_members(uuid,date,date,text,text,text,text,text);
drop function if exists public.owned_media_page(uuid,date,date,text,text,text,text,text,integer);
drop index if exists public.owned_library_ads_media;
alter table public.owned_library_ads drop column if exists meta_created_time, drop column if exists media_key;
notify pgrst,'reload schema';
