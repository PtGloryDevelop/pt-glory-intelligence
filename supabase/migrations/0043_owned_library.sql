create table public.owned_library_syncs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running','completed','failed')),
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_snapshot_at timestamptz,
  date_start date,
  date_end date,
  accounts jsonb not null default '[]',
  completed_accounts integer not null default 0,
  ad_count integer not null default 0,
  error text
);
create unique index owned_library_one_running on public.owned_library_syncs ((status)) where status='running';
create table public.owned_library_ads (
  sync_id uuid not null references public.owned_library_syncs(id) on delete cascade,
  account_id text not null,
  ad_id text not null check (ad_id ~ '^[0-9]{1,32}$'),
  ad_name text not null,
  account_name text not null,
  campaign_name text not null,
  page_name text,
  status text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  spend numeric,
  data jsonb not null,
  primary key (sync_id,account_id,ad_id)
);
create index owned_library_ads_account on public.owned_library_ads(sync_id,account_id);
create index owned_library_ads_status on public.owned_library_ads(sync_id,status);
create index owned_library_ads_spend on public.owned_library_ads(sync_id,spend desc nulls last,account_id,ad_id);
alter table public.owned_library_syncs enable row level security;
alter table public.owned_library_ads enable row level security;
revoke all on public.owned_library_syncs,public.owned_library_ads from public,anon,authenticated;
grant select on public.owned_library_syncs,public.owned_library_ads to authenticated;
create policy owned_library_syncs_read on public.owned_library_syncs for select to authenticated
using(public.current_user_role() in ('analyst','admin'));
create policy owned_library_ads_read on public.owned_library_ads for select to authenticated
using(public.current_user_role() in ('analyst','admin') and exists (
  select 1 from public.owned_library_syncs s where s.id=sync_id and s.status='completed'
));
notify pgrst,'reload schema';
