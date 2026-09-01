create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id),
  collection_run_id uuid not null references public.collection_runs(id),
  name text not null,
  version int not null default 1,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  deleted_at timestamptz
);
