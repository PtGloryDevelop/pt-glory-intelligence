-- Summaries belong to an immutable source snapshot. Compute once when the
-- sync publishes, rather than scanning 73,000 creative JSON rows on each visit.
alter table public.owned_library_syncs add column if not exists dashboard_summary jsonb;
create or replace function public.dashboard_owned_compute(p_sync uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare snapshot public.owned_library_syncs; currencies jsonb; top_ads jsonb;
begin
  select * into snapshot from public.owned_library_syncs where id=p_sync;
  if snapshot.id is null then raise exception 'Source snapshot required' using errcode='22023'; end if;

  with amounts as (
    select currency,status,spend,
      (data->>'conversations')::numeric conversations,(data->>'purchases')::numeric purchases,
      (data->>'purchase_value')::numeric purchase_value,
      -- No delivery record means unknown, not a zero-performing ad. The
      -- inventory count and the performance cohort remain separate.
      (spend is not null or data->>'impressions' is not null or data->>'clicks' is not null
        or data->>'conversations' is not null or data->>'purchases' is not null
        or data->>'purchase_value' is not null or data->>'video_3s' is not null or data->>'thruplays' is not null) as reported
    from public.owned_library_ads where sync_id=snapshot.id
  ), sums as (
    select currency,count(*) inventory,count(*) filter(where status='ACTIVE') active,
      count(*) filter(where status is null) unknown_status,count(*) filter(where reported) metrics_ads,
      sum(spend) spend,count(spend) spend_present,
      sum(conversations) conversations,count(conversations) conversations_present,
      sum(purchases) purchases,count(purchases) purchases_present,
      sum(purchase_value) purchase_value,count(purchase_value) purchase_value_present,
      count(*) filter(where spend is not null and purchase_value is not null) roas_present,
      sum(spend) filter(where purchase_value is not null) roas_spend,
      sum(purchase_value) filter(where spend is not null) roas_value
    from amounts group by currency
  )
  select jsonb_agg(jsonb_build_object('currency',s.currency,'inventory',s.inventory,'active',s.active,
    'unknownStatus',s.unknown_status,'metricsAds',s.metrics_ads,'metrics',m.metrics || jsonb_build_object(
      'roas',jsonb_build_object('value',case when s.metrics_ads>0 and s.roas_present=s.metrics_ads and s.roas_spend>0 then s.roas_value/s.roas_spend end,
        'present',s.roas_present,'total',s.metrics_ads))) order by s.currency) into currencies
  from sums s cross join lateral (
    select jsonb_object_agg(field,jsonb_build_object('value',case when s.metrics_ads>0 and present=s.metrics_ads then amount end,
      'reportedValue',amount,'present',present,'total',s.metrics_ads)) metrics
    from (values ('spend',s.spend,s.spend_present),('conversations',s.conversations,s.conversations_present),
      ('purchases',s.purchases,s.purchases_present),('purchase_value',s.purchase_value,s.purchase_value_present)) v(field,amount,present)
  ) m;
  currencies:=coalesce(currencies,'[]'::jsonb);

  -- Six per currency. A THB amount is never ranked against a USD amount.
  select coalesce(jsonb_agg(p.data order by c.currency,p.spend desc,p.account_id,p.ad_id),'[]'::jsonb) into top_ads
    from jsonb_to_recordset(currencies) c(currency text)
    cross join lateral (select data,spend,account_id,ad_id from public.owned_library_ads
      where sync_id=snapshot.id and currency=c.currency and spend>0
      order by spend desc,account_id,ad_id limit 6) p;
  return jsonb_build_object('currencies',currencies,'topAds',top_ads,
    'inventory',coalesce((select sum((c->>'inventory')::bigint) from jsonb_array_elements(currencies) c),0),
    'active',coalesce((select sum((c->>'active')::bigint) from jsonb_array_elements(currencies) c),0),
    'unknownStatus',coalesce((select sum((c->>'unknownStatus')::bigint) from jsonb_array_elements(currencies) c),0),
    'metricsAds',coalesce((select sum((c->>'metricsAds')::bigint) from jsonb_array_elements(currencies) c),0));
end $$;
revoke all on function public.dashboard_owned_compute(uuid) from public,anon,authenticated;

create or replace function public.dashboard_owned_publish()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.owned_library_syncs set dashboard_summary=public.dashboard_owned_compute(new.id) where id=new.id;
  return new;
end $$;
revoke all on function public.dashboard_owned_publish() from public,anon,authenticated;
create or replace trigger dashboard_owned_publish after insert or update of status on public.owned_library_syncs
for each row when(new.status='completed') execute function public.dashboard_owned_publish();

update public.owned_library_syncs set dashboard_summary=public.dashboard_owned_compute(id)
where status='completed' and dashboard_summary is null;

-- Completed company inventory only. The narrowly scoped definer has a role
-- check before any financial read; private compute functions have no API grant.
create or replace function public.dashboard_owned_summary()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare snapshot public.owned_library_syncs; progress jsonb; result jsonb;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('analyst','admin') then
    raise exception 'Analyst authorization required' using errcode='42501';
  end if;
  select * into snapshot from public.owned_library_syncs where status='completed' order by finished_at desc,id limit 1;
  select jsonb_build_object('id',id,'status',status,'completed_accounts',completed_accounts,
    'accountsCount',jsonb_array_length(accounts),'started_at',started_at,'finished_at',finished_at)
    into progress from public.owned_library_syncs order by started_at desc,id limit 1;
  if snapshot.id is null then return jsonb_build_object('snapshot',null,'progress',progress,'currencies','[]'::jsonb,'topAds','[]'::jsonb,'inventory',0,'active',0,'unknownStatus',0,'metricsAds',0); end if;
  result:=snapshot.dashboard_summary;
  return result || jsonb_build_object('snapshot',jsonb_build_object('id',snapshot.id,'finished_at',snapshot.finished_at,
    'source_snapshot_at',snapshot.source_snapshot_at,'date_start',snapshot.date_start,'date_end',snapshot.date_end,
    'ad_count',snapshot.ad_count,'accounts',snapshot.accounts),'progress',progress);
end $$;
revoke all on function public.dashboard_owned_summary() from public,anon;
grant execute on function public.dashboard_owned_summary() to authenticated;

-- The existing scope primitive selects one observation per ad across all
-- non-deleted datasets. Joining dataset counts would double count repeats.
create or replace function public.dashboard_rival_summary()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  with current_ads as (
    select a.page_ref,a.first_seen_at,o.is_active
    from public.page_scope_observations('all',null) s
    join public.ads a on a.id=s.ad_ref join public.ad_observations o on o.id=s.observation_id
  )
  select jsonb_build_object('ads',count(*),'pages',count(distinct page_ref),
    'active',count(*) filter(where is_active is true),'inactive',count(*) filter(where is_active is false),
    'unknown',count(*) filter(where is_active is null),
    'recentlyFound',count(*) filter(where first_seen_at>=now()-interval '30 days'),
    'lastCollectedAt',(select max(cr.collected_at) from public.datasets d join public.collection_runs cr on cr.id=d.collection_run_id where d.deleted_at is null),
    'datasets',(select count(*) from public.datasets where deleted_at is null)) from current_ads
$$;
revoke all on function public.dashboard_rival_summary() from public,anon;
grant execute on function public.dashboard_rival_summary() to authenticated;
notify pgrst,'reload schema';
