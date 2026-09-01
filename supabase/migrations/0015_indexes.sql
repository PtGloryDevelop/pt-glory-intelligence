create index ads_page_ref_idx on public.ads (page_ref);
create index ads_start_date_idx on public.ads (start_date desc);
create index ads_first_seen_idx on public.ads (first_seen_at desc);
create index ads_active_idx on public.ads (is_active) where is_active;

-- Snapshot reads: one observation per ad per run makes dataset queries
-- deterministic without DISTINCT ON, and blocks duplicate rows at the schema.
create unique index ad_obs_run_ad_idx on public.ad_observations (collection_run_id, ad_ref);
create unique index page_obs_run_page_idx on public.page_observations (collection_run_id, page_ref);

create index ad_obs_history_idx on public.ad_observations (ad_ref, observed_at desc);
create index page_obs_history_idx on public.page_observations (page_ref, observed_at desc);

create index dataset_ads_ad_idx on public.dataset_ads (ad_ref);
create index datasets_category_idx on public.datasets (category_id, created_at desc);
create index dataset_quality_dataset_idx on public.dataset_quality (dataset_id);
create index quarantine_run_idx on public.import_quarantine (collection_run_id);

create index ads_platform_gin on public.ads using gin (publisher_platform);
create index page_obs_categories_gin on public.page_observations using gin (page_categories);
create index ad_obs_body_trgm on public.ad_observations using gin (body_text gin_trgm_ops);
