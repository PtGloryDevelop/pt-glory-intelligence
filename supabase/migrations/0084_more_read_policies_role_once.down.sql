-- Rollback of 0084: the three read policies as migrations 0016 and 0023 wrote them. No app build
-- depends on either form; reads only get slower again.
set local lock_timeout = '3s';
alter policy dataset_ads_read  on public.dataset_ads  using (public.current_user_role() is not null);
alter policy media_assets_read on public.media_assets using (public.current_user_role() is not null);
alter policy audit_logs_read   on public.audit_logs   using (public.current_user_role() = 'admin');
