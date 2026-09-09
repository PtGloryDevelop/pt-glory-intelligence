-- Drops the Trends read layer. 0030 stores nothing — no table, no cached trend
-- — so rolling it back removes six read functions and touches no row.

drop function if exists public.trend_evidence(text, uuid, text, text, timestamptz, timestamptz, timestamptz, text, text, text, text, int, int);
drop function if exists public.trend_context(text, uuid, timestamptz, timestamptz);
drop function if exists public.trend_mix(text, uuid, text, timestamptz, timestamptz);
drop function if exists public.trend_pages(text, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, text, int, int);
drop function if exists public.trend_summary(text, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz);
-- Last: every function above depends on it.
drop function if exists public.trend_state_scope(text, uuid, timestamptz);
