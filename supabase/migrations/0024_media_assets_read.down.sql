-- Restores the 0022 definitions of both read functions, without the archive
-- reference. Written as a re-apply of 0022's own statements rather than a
-- hand-written inverse, so reverting cannot quietly change filter behaviour.
--
-- Storage objects are untouched: see 0023's down migration for why.
\echo 'Revert 0024 by re-applying 0022_explorer_read_layer.sql, which recreates'
\echo 'dataset_ads_page and ad_detail without archive_path/archive_status.'
