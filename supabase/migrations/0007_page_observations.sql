create table public.page_observations (
  id bigserial primary key,
  page_ref uuid not null references public.pages(id) on delete cascade,
  collection_run_id uuid not null references public.collection_runs(id) on delete cascade,
  observed_at timestamptz not null,
  page_name text,
  page_like_count bigint,
  page_categories text[]
);
