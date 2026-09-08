-- Drops the Category workspace read layer. 0028 stores nothing, so rolling it
-- back removes eight functions and touches no row.

drop function if exists public.category_evidence(uuid, text, int, text, text, text, text, text, timestamptz, timestamptz, text, int, int);
drop function if exists public.category_run_history(uuid);
drop function if exists public.category_activity(uuid, text, timestamptz, timestamptz);
drop function if exists public.category_creative_mix(uuid);
drop function if exists public.category_pages(uuid, int, text, text, int, int);
drop function if exists public.category_datasets(uuid);
drop function if exists public.category_detail(uuid, int);
drop function if exists public.category_list();
