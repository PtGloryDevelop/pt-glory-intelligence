-- Drops the Page timeline read layer. 0027 stores nothing, so rolling it back
-- removes five functions and touches no row.

drop function if exists public.page_timeline_evidence(text, uuid, text, text, timestamptz, timestamptz, uuid, text, int, int);
drop function if exists public.page_run_mix(text, uuid, text, uuid);
drop function if exists public.page_run_history(text, uuid, text);
drop function if exists public.page_timeline(text, uuid, text, text, timestamptz, timestamptz);
drop function if exists public.page_scope_ads(text, uuid);
