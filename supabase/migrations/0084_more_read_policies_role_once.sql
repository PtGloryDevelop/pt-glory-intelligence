-- The same change as 0083, for the three other large tables whose read policy asked
-- public.current_user_role() again for every row: dataset_ads and media_assets (read with the ads in
-- the explorer, the catalog and the page reads) and audit_logs. A scalar subquery is evaluated once
-- per statement, so the caller's role row is looked up once and the answer used for every row.
--
-- Who may read does not change: dataset_ads and media_assets still ask for a role row, any role;
-- audit_logs still asks for the admin role. Only these three SELECT policies change. The insert,
-- update and delete policies of dataset_ads are left as they are (writes come from the import on the
-- privileged connection), and media_assets and audit_logs have no other policy.
--
-- ALTER POLICY needs each table for an instant; give up after 3 s instead of making readers and the
-- archive drain queue behind a waiting lock (run the migration again if that happens).
set local lock_timeout = '3s';
alter policy dataset_ads_read  on public.dataset_ads  using ((select public.current_user_role()) is not null);
alter policy media_assets_read on public.media_assets using ((select public.current_user_role()) is not null);
alter policy audit_logs_read   on public.audit_logs   using ((select public.current_user_role()) = 'admin');
