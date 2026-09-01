create table public.dataset_ads (
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  ad_ref uuid not null references public.ads(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (dataset_id, ad_ref)
);
