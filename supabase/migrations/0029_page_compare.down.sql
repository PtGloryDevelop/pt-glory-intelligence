-- Drops the Page compare read layer. 0029 stores nothing and defines no
-- formula, so rolling it back removes four projections and touches no row.

drop function if exists public.page_compare_timeline(text, uuid, text, text, text, text, timestamptz, timestamptz);
drop function if exists public.page_compare_mix(text, uuid, text, text);
drop function if exists public.page_compare_summary(text, uuid, text, text, int);
drop function if exists public.page_in_scope(text, uuid, text);
