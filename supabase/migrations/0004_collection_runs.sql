create table public.collection_runs (
  id uuid primary key default gen_random_uuid(),
  source_product text not null,
  collection_method text not null
    check (collection_method in
      ('network_response_observation','user_initiated_dom_observation','socialapis_api')),
  collector_schema_version text not null,
  source_url text,
  completeness_claim text,
  scope_country text,
  scope_query text,
  scope_active_status text,
  scope_ad_type text,
  scope_media_type text,
  collected_at timestamptz not null,
  stop_reason text,
  -- Numbers the collector reported. Provenance only: never a canonical metric.
  reported_source_rows int,
  reported_unique_ads int,
  reported_unique_pages int,
  reported_unresolved_count int,
  reported_quality_summary jsonb,
  -- Numbers the server recomputed from the parsed file. Canonical.
  computed_source_rows int not null,
  computed_unique_ads int not null,
  computed_unique_pages int not null,
  computed_unresolved_count int not null,
  status text not null check (status in ('completed','partial')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
