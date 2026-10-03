-- Immutable company performance snapshots. Requires 0002 user_roles and the
-- existing current_user_role() function. Apply through the normal migration
-- workflow before enabling /owned-ads; this file does not call any ad provider.
-- These rows are separate from competitor ads/ad_observations and their public
-- data contract. Purchase values remain uploaded attribution, not booked sales.

-- Authenticated clients can reach INSERT through PostgREST too. The row
-- contract therefore also lives at the table boundary, before data is stored.
create function public.owned_ad_report_rows_valid(input jsonb)
returns boolean
language sql immutable parallel safe
set search_path = public, pg_temp
as $$
  select case when jsonb_typeof(input) <> 'array' then false else
    not exists (
      select 1 from jsonb_array_elements(input) as item(ad_row)
      where jsonb_typeof(ad_row) <> 'object'
        or not (ad_row ?& array[
          'ad_id','ad_name','campaign_name','adset_name','status','spend',
          'impressions','clicks','conversations','purchases','purchase_value',
          'video_3s','thruplays','creative_url','destination_url'
        ])
        or jsonb_typeof(ad_row -> 'ad_id') <> 'string'
        or not coalesce(ad_row ->> 'ad_id' ~ '^[0-9]{1,32}$', false)
        or jsonb_typeof(ad_row -> 'ad_name') <> 'string'
        or not coalesce(length(btrim(ad_row ->> 'ad_name')) between 1 and 500, false)
        or jsonb_typeof(ad_row -> 'campaign_name') <> 'string'
        or not coalesce(length(btrim(ad_row ->> 'campaign_name')) between 1 and 500, false)
        or exists (
          select 1 from (values ('adset_name',500),('status',100),('creative_url',2048),('destination_url',2048)) as field(key,max_length)
          where not coalesce(
            jsonb_typeof(ad_row -> field.key) = 'null'
            or (jsonb_typeof(ad_row -> field.key) = 'string'
              and length(btrim(ad_row ->> field.key)) between 1 and field.max_length), false)
        )
        or exists (
          select 1 from unnest(array['spend','impressions','clicks','conversations','purchases','purchase_value','video_3s','thruplays']) as field(key)
          where not coalesce(case when jsonb_typeof(ad_row -> field.key) = 'number' then
            (ad_row ->> field.key)::numeric between 0 and 9007199254740991
            and (field.key in ('spend','purchases','purchase_value')
              or trunc((ad_row ->> field.key)::numeric) = (ad_row ->> field.key)::numeric)
            else jsonb_typeof(ad_row -> field.key) = 'null' end, false)
        )
        or exists (
          select 1 from unnest(array['creative_url','destination_url']) as field(key)
          where jsonb_typeof(ad_row -> field.key) = 'string'
            and not coalesce(ad_row ->> field.key ~ '^https?://[^/@[:space:]]+([/?#][^[:space:]]*)?$', false)
        )
    )
    and (select count(distinct item.ad_row ->> 'ad_id') = jsonb_array_length(input)
      from jsonb_array_elements(input) as item(ad_row))
  end;
$$;
revoke all on function public.owned_ad_report_rows_valid(jsonb) from public, anon;
grant execute on function public.owned_ad_report_rows_valid(jsonb) to authenticated;

create table public.owned_ad_reports (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  account_name text not null check (length(btrim(account_name)) between 1 and 200),
  currency text not null check (currency = 'THB'),
  date_start date not null check (date_start between date '0001-01-01' and date '9999-12-31'),
  date_end date not null check (date_end >= date_start and date_end <= date '9999-12-31'),
  source_label text not null default 'รายงานที่อัปโหลดโดยทีมบริษัท'
    check (source_label = 'รายงานที่อัปโหลดโดยทีมบริษัท'),
  imported_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  rows jsonb not null check (public.owned_ad_report_rows_valid(rows))
    check (octet_length(rows::text) <= 10 * 1024 * 1024),
  row_count integer generated always as (jsonb_array_length(rows)) stored
    check (row_count between 1 and 5000)
);

create index owned_ad_reports_imported_at_idx on public.owned_ad_reports (imported_at desc);
alter table public.owned_ad_reports enable row level security;
revoke all on table public.owned_ad_reports from public, anon, authenticated, service_role;
grant select on table public.owned_ad_reports to authenticated;
grant insert (name, account_name, currency, date_start, date_end, source_label, created_by, rows)
  on table public.owned_ad_reports to authenticated;

create policy owned_ad_reports_read on public.owned_ad_reports
  for select to authenticated
  using (public.current_user_role() in ('analyst', 'admin'));

create policy owned_ad_reports_insert on public.owned_ad_reports
  for insert to authenticated
  with check (public.current_user_role() in ('analyst', 'admin') and created_by = auth.uid());

comment on table public.owned_ad_reports is
  'Company-shared immutable uploaded reports; analyst/admin only. Select one snapshot when aggregating to avoid overlapping periods.';

notify pgrst, 'reload schema';
