-- Drops the Page Intelligence read layer. 0026 stores nothing, so rolling it
-- back removes seven functions and touches no row.

drop function if exists public.page_ads(text, uuid, text, text, int, text, text, text, text, int, int);
drop function if exists public.page_like_history(text, uuid, text);
drop function if exists public.page_activity(text, uuid, text, text);
drop function if exists public.page_creative_mix(text, uuid, text);
drop function if exists public.page_detail(text, uuid, text, int);
drop function if exists public.page_list(text, uuid, text, text, text, int, text, int, int);
-- Last: every function above depends on it.
drop function if exists public.page_scope_observations(text, uuid);
