-- Drops Watchlist V1. The saved targets are personal research state, so this
-- removes them; nothing it deletes is imported data.

drop function if exists public.watchlist_reset_baseline(uuid);
drop function if exists public.watchlist_list();
drop function if exists public.watchlist_signal_evidence(uuid, text, int, int);
drop function if exists public.watchlist_signal_summary(uuid);
drop function if exists public.watch_scope_ads(uuid);
drop table if exists public.watch_items;
