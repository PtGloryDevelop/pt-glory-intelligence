-- Rollback of 0083: the four read policies as migration 0016 wrote them. No app build depends on
-- either form; reads only get slower again.
set local lock_timeout = '3s';
alter policy pages_read             on public.pages             using (public.current_user_role() is not null);
alter policy page_observations_read on public.page_observations using (public.current_user_role() is not null);
alter policy ads_read               on public.ads               using (public.current_user_role() is not null);
alter policy ad_observations_read   on public.ad_observations   using (public.current_user_role() is not null);
