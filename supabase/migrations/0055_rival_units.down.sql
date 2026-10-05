-- Removes team keywords, page relations and the company tracking list (team-entered rows only; no source data).
drop function if exists public.rival_keyword_pages(text[]);
drop table if exists public.rival_tracked_pages;
drop table if exists public.rival_page_units;
drop table if exists public.unit_keywords;
notify pgrst, 'reload schema';
