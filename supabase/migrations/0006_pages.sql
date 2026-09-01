create table public.pages (
  id uuid primary key default gen_random_uuid(),
  page_id text not null unique,
  -- Distinct identifier: differs from page_id in every row that has one.
  page_profile_numeric_id text,
  page_profile_uri text,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
