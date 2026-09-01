create table public.dataset_quality (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  field text not null,
  present_count int not null,
  total_count int not null,
  coverage numeric generated always as
    (present_count::numeric / nullif(total_count, 0)) stored,
  tier text not null check (tier in ('normal','partial','low')),
  computed_at timestamptz not null default now(),
  unique (dataset_id, field)
);
