create table public.ads (
  id uuid primary key default gen_random_uuid(),
  -- Master identity. Rows without one are quarantined, never inserted here.
  ad_archive_id text not null unique,
  page_ref uuid not null references public.pages(id),
  collation_id text,
  start_date timestamptz not null,
  end_date timestamptz,
  -- NULL means the collector could not read the state. Not the same as false.
  is_active boolean,
  display_format text,
  publisher_platform text[],
  -- MIN/MAX over collection_runs.collected_at, not the row insert time.
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
