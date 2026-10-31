-- 0078 — per-ad totals for a snapshot's whole window, built once per sync instead of on every read (31 Oct).
--
-- The compare page reads our ads over the snapshot's whole window (period=all). By 30 Oct the snapshot had
-- 11,459 ads and 89,745 daily rows, and owned_performance_page regrouped every one of them on each read
-- (2-6 s warm, spilling its sorts to disk), so on the Micro compute's throttled CPU it passed the 8 s
-- statement timeout (57014) whenever the page opened. The grouping does not change once a snapshot is
-- published, so it is done once, when the sync is marked complete, and stored.
--
-- owned_performance_page now answers from the stored totals when the read is the whole window with no unit
-- or page filter (the slow case); every other read goes to the unchanged body, renamed
-- owned_performance_page_live. A missing build (an old snapshot, a failed build) also goes there: slower,
-- never different. Before this migration was applied, both paths were run side by side on the pilot data
-- and returned identical JSON.

create table public.owned_library_window (
  sync_id uuid primary key references public.owned_library_syncs(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  ads integer not null,
  -- Ads with daily rows but no inventory row whose name or page changed within the window: the live search
  -- matches those day by day, which stored totals cannot, so a search goes live while any exist.
  daily_text_changing integer not null,
  built_at timestamptz not null default now()
);

-- Exactly what owned_performance_page's `grouped` computes over the whole window, plus each ad's share of
-- the summary (row counts per metric and raw sums), so the summary of any subset of ads adds up the same.
create table public.owned_library_ad_totals (
  sync_id uuid not null references public.owned_library_syncs(id) on delete cascade,
  account_id text not null,
  ad_id text not null,
  currency text not null,
  ad_name text, page_id text, page_name text,
  unit_ids text[] not null, unit_names text[] not null,
  spend numeric, impressions numeric, clicks numeric, conversations numeric, purchases numeric,
  purchase_value numeric, video_3s numeric, thruplays numeric,
  roas numeric, cost_per_conversation numeric, hook_rate numeric,
  delivery_first date, delivery_last date, delivery_days bigint,
  -- For an ad with no inventory row: the text the live search matches its daily rows by.
  daily_text text,
  n_rows bigint not null, n_spend bigint not null, n_conversations bigint not null, n_purchases bigint not null,
  n_purchase_value bigint not null, n_impressions bigint not null, n_video_views bigint not null,
  n_roas bigint not null, n_hook bigint not null,
  s_spend numeric, s_conversations numeric, s_purchases numeric, s_purchase_value numeric,
  s_impressions numeric, s_video_views numeric,
  primary key (sync_id, account_id, ad_id, currency)
);
comment on table public.owned_library_ad_totals is 'Per-ad totals over a snapshot''s whole daily window, built once per sync (0078). Read only through owned_performance_page.';

-- Read only through the security-definer functions below.
alter table public.owned_library_window enable row level security;
alter table public.owned_library_ad_totals enable row level security;
revoke all on table public.owned_library_window, public.owned_library_ad_totals from public, anon, authenticated;

create or replace function public.owned_build_ad_totals(p_sync uuid)
returns integer language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare v_from date; v_to date; v_count integer;
begin
  select daily_from, daily_to into v_from, v_to from public.owned_library_syncs where id=p_sync and status='completed' and daily_ready;
  if v_from is null or v_to is null then return 0; end if;
  delete from public.owned_library_ad_totals where sync_id=p_sync;
  delete from public.owned_library_window where sync_id=p_sync;
  -- candidates, days and the grouped columns are owned_performance_page's, with no filter and the whole window.
  with candidates as materialized (
    select d.* from public.owned_library_daily d where d.sync_id=p_sync and d.insight_date between v_from and v_to
  ), days as materialized (
    select c.* from candidates c where exists(select 1 from candidates e
      where e.account_id=c.account_id and e.ad_id=c.ad_id and e.currency=c.currency and e.spend>0)
  )
  insert into public.owned_library_ad_totals
  select p_sync, account_id, ad_id, currency,
    (array_agg(ad_name order by insight_date desc))[1],
    (array_agg(page_id order by insight_date desc))[1],
    (array_agg(page_name order by insight_date desc))[1],
    coalesce(array_agg(distinct unit_id::text) filter(where unit_id is not null),'{}'::text[]),
    coalesce(array_agg(distinct unit_name) filter(where unit_name is not null),'{}'::text[]),
    case when count(spend)=count(*) then sum(spend) end,
    case when count(impressions)=count(*) then sum(impressions) end,
    case when count(clicks)=count(*) then sum(clicks) end,
    case when count(conversations)=count(*) then sum(conversations) end,
    case when count(purchases)=count(*) then sum(purchases) end,
    case when count(purchase_value)=count(*) then sum(purchase_value) end,
    case when count(video_3s)=count(*) then sum(video_3s) end,
    case when count(thruplays)=count(*) then sum(thruplays) end,
    case when count(spend)=count(*) and count(purchase_value)=count(*) and sum(spend)>0 then sum(purchase_value)/sum(spend) end,
    case when count(spend)=count(*) and count(conversations)=count(*) and sum(conversations)>0 then sum(spend)/sum(conversations) end,
    case when count(video_views)=count(*) and count(impressions)=count(*) and sum(impressions)>0 then sum(video_views)/sum(impressions) end,
    (select min(h.insight_date) from public.owned_library_daily h where h.sync_id=p_sync and h.account_id=d.account_id and h.ad_id=d.ad_id and h.spend>0),
    max(insight_date) filter(where spend>0),
    case when count(spend)=count(*) then count(*) filter(where spend>0) end,
    case when not exists(select 1 from public.owned_library_ads i where i.sync_id=p_sync and i.account_id=d.account_id and i.ad_id=d.ad_id)
      then min(d.ad_id||' '||d.ad_name||' '||coalesce(d.page_name,'')||'  ') end,
    count(*), count(spend), count(conversations), count(purchases), count(purchase_value), count(impressions), count(video_views),
    count(*) filter(where spend is not null and purchase_value is not null),
    count(*) filter(where video_views is not null and impressions is not null),
    sum(spend), sum(conversations), sum(purchases), sum(purchase_value), sum(impressions), sum(video_views)
  from days d group by account_id, ad_id, currency;
  get diagnostics v_count = row_count;
  insert into public.owned_library_window (sync_id, from_date, to_date, ads, daily_text_changing)
  values (p_sync, v_from, v_to, v_count, (select count(*) from (
    select d.account_id, d.ad_id from public.owned_library_daily d
    where d.sync_id=p_sync and d.insight_date between v_from and v_to
      and not exists(select 1 from public.owned_library_ads i where i.sync_id=d.sync_id and i.account_id=d.account_id and i.ad_id=d.ad_id)
    group by 1, 2 having count(distinct d.ad_id||' '||d.ad_name||' '||coalesce(d.page_name,'')) > 1) x));
  return v_count;
end $function$;
revoke all on function public.owned_build_ad_totals(uuid) from public, anon, authenticated;

-- Built when a sync is published, in the sync's own transaction, whatever version of the sync script runs.
-- A failed build never fails the publish: the reads go live until the next build.
create or replace function public.owned_ad_totals_on_publish()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  begin
    perform public.owned_build_ad_totals(new.id);
  exception when others then
    raise warning 'owned ad totals not built for %: %', new.id, sqlerrm;
  end;
  return null;
end $function$;
revoke all on function public.owned_ad_totals_on_publish() from public, anon, authenticated;
create trigger owned_ad_totals_publish
  after update of status, daily_ready, daily_from, daily_to on public.owned_library_syncs
  for each row when (new.status='completed' and new.daily_ready)
  execute function public.owned_ad_totals_on_publish();

alter function public.owned_performance_page(uuid, date, date, text, text, text, text, text, integer) rename to owned_performance_page_live;
revoke all on function public.owned_performance_page_live(uuid, date, date, text, text, text, text, text, integer) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.owned_performance_page(p_sync uuid, p_from date, p_to date, p_unit text, p_page_id text, p_search text, p_sort text, p_status text, p_page integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare result jsonb;
  v_sort text := split_part(p_sort,':',1);
  v_desc boolean;
  v_changing integer;
  v_pattern text;
begin
  if (select public.current_user_role()) is null or (select public.current_user_role()) not in ('analyst','admin') then
    raise exception 'Analyst authorization required' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_from>p_to
    or p_from<date '0001-01-01' or p_to>date '9999-12-31'
    or p_unit is null or (p_unit<>'' and p_unit !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or p_page_id is null or (p_page_id<>'' and p_page_id !~ '^[0-9]{1,32}$')
    or p_search is null or length(p_search)>160
    or p_sort is null or p_sort !~ '^(spend|cost_per_conversation|roas|conversations|hook_rate|newest|longest|close_rate)(:(asc|desc))?$'
    or p_status is null or p_status not in ('','ACTIVE','PAUSED','CAMPAIGN_PAUSED','ADSET_PAUSED','ARCHIVED','DELETED','DISAPPROVED','WITH_ISSUES')
    or p_page is null or p_page<0 or p_page>100000 then
    raise exception 'Invalid performance filters' using errcode='22023';
  end if;
  -- Stored totals answer only the whole window of a published snapshot, unfiltered by unit or page.
  select w.daily_text_changing into v_changing from public.owned_library_window w
    join public.owned_library_syncs s on s.id=w.sync_id
    where w.sync_id=p_sync and w.from_date=p_from and w.to_date=p_to
      and s.status='completed' and s.daily_ready and s.daily_from=w.from_date and s.daily_to=w.to_date;
  if not found or p_unit<>'' or p_page_id<>'' or (p_search<>'' and v_changing>0) then
    return public.owned_performance_page_live(p_sync,p_from,p_to,p_unit,p_page_id,p_search,p_sort,p_status,p_page);
  end if;
  v_desc := case split_part(p_sort,':',2) when 'asc' then false when 'desc' then true else v_sort<>'cost_per_conversation' end;
  v_pattern := '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%';
  with recursive grouped as materialized (
    -- The live body's search: an inventory ad by its stored search text, an ad without one by its daily text.
    select t.* from public.owned_library_ad_totals t
    left join public.owned_library_ads a on a.sync_id=t.sync_id and a.account_id=t.account_id and a.ad_id=t.ad_id
    where t.sync_id=p_sync and (p_status='' or a.status=p_status)
      and (p_search='' or case when a.ad_id is not null
        then (case when p_search ~ '[[:alnum:]]{3}' then a.search_text else a.search_text||'' end) ilike v_pattern escape '\'
        else t.daily_text ilike v_pattern escape '\' end)
  ), totals as (
    select currency,sum(n_rows) daily_rows,count(*) ad_count,
      case when sum(n_spend)=sum(n_rows) then sum(s_spend) end spend,
      case when sum(n_conversations)=sum(n_rows) then sum(s_conversations) end conversations,
      case when sum(n_purchases)=sum(n_rows) then sum(s_purchases) end purchases,
      case when sum(n_purchase_value)=sum(n_rows) then sum(s_purchase_value) end purchase_value,
      case when sum(n_impressions)=sum(n_rows) then sum(s_impressions) end impressions,
      case when sum(n_video_views)=sum(n_rows) then sum(s_video_views) end video_views,
      case when sum(n_spend)=sum(n_rows) and sum(n_purchase_value)=sum(n_rows) and sum(s_spend)>0 then sum(s_purchase_value)/sum(s_spend) end roas,
      case when sum(n_spend)=sum(n_rows) and sum(n_conversations)=sum(n_rows) and sum(s_conversations)>0 then sum(s_spend)/sum(s_conversations) end cost_per_conversation,
      case when sum(n_video_views)=sum(n_rows) and sum(n_impressions)=sum(n_rows) and sum(s_impressions)>0 then sum(s_video_views)/sum(s_impressions) end hook_rate,
      jsonb_build_object(
        'spend',jsonb_build_object('present',sum(n_spend),'total',sum(n_rows)),
        'conversations',jsonb_build_object('present',sum(n_conversations),'total',sum(n_rows)),
        'purchase_value',jsonb_build_object('present',sum(n_purchase_value),'total',sum(n_rows)),
        'roas',jsonb_build_object('present',sum(n_roas),'total',sum(n_rows)),
        'hook_rate',jsonb_build_object('present',sum(n_hook),'total',sum(n_rows))
      ) coverage,
      null::numeric close_rate
    from grouped group by currency
  ), ranked as (
    select g.*,row_number() over (order by currency,
      case when v_desc then sort_key end desc nulls last,
      case when not v_desc then sort_key end asc nulls last,
      account_id,ad_id) ordinal
    from grouped g cross join lateral (select case v_sort
      when 'spend' then g.spend when 'cost_per_conversation' then g.cost_per_conversation when 'roas' then g.roas
      when 'conversations' then g.conversations::numeric when 'hook_rate' then g.hook_rate
      when 'newest' then (g.delivery_first-date '2000-01-01')::numeric when 'longest' then g.delivery_days::numeric
      when 'close_rate' then case when g.conversations>=30 then g.purchases::numeric/g.conversations end end sort_key) k
  ), page as (
    select * from ranked order by ordinal
    limit 24 offset p_page*24
  ), cards as (
    select coalesce(a.data,'{}'::jsonb)||jsonb_build_object(
      'account_id',g.account_id,'account_name',coalesce(a.account_name,(select item->>'name' from public.owned_library_syncs s
        cross join lateral jsonb_array_elements(s.accounts) item where s.id=p_sync and item->>'id'=g.account_id),g.account_id),
      'currency',g.currency,'ad_id',g.ad_id,'ad_name',g.ad_name,
      'campaign_name',coalesce(a.campaign_name,'ไม่ทราบแคมเปญ'),'adset_name',a.data->>'adset_name','status',a.status,
      'page_id',g.page_id,'page_name',g.page_name,'title',a.data->>'title','body_text',a.data->>'body_text',
      'creative_url',a.data->>'creative_url','destination_url',a.data->>'destination_url',
      'creative_id',a.data->>'creative_id','video_id',a.data->>'video_id','created_time',a.data->>'created_time',
      'spend',g.spend,'impressions',g.impressions,'clicks',g.clicks,'conversations',g.conversations,
      'purchases',g.purchases,'purchase_value',g.purchase_value,'video_3s',g.video_3s,'thruplays',g.thruplays,
      'unit_ids',g.unit_ids,'unit_names',g.unit_names,'hook_rate',g.hook_rate,'cost_per_conversation',g.cost_per_conversation,
      'delivery_first',g.delivery_first,
      'delivery_last',g.delivery_last,'delivery_days',g.delivery_days
    ) data,g.ordinal
    from page g left join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=g.account_id and a.ad_id=g.ad_id
  ), unit_keys(unit_id) as (
    (select d.unit_id from public.owned_library_daily d where d.sync_id=p_sync and d.unit_id is not null order by d.unit_id limit 1)
    union all
    select (select d.unit_id from public.owned_library_daily d where d.sync_id=p_sync and d.unit_id>k.unit_id order by d.unit_id limit 1)
    from unit_keys k where k.unit_id is not null
  ), units as (
    select k.unit_id::text id,coalesce((select d.unit_name from public.owned_library_daily d
      where d.sync_id=p_sync and d.unit_id=k.unit_id order by d.insight_date desc limit 1),k.unit_id::text) name
    from unit_keys k where k.unit_id is not null
  ), page_keys(page_id) as (
    (select d.page_id from public.owned_library_daily d where d.sync_id=p_sync and d.page_id is not null
      and (p_unit='' or d.unit_id::text=p_unit) order by d.page_id limit 1)
    union all
    select (select d.page_id from public.owned_library_daily d where d.sync_id=p_sync and d.page_id>k.page_id
      and (p_unit='' or d.unit_id::text=p_unit) order by d.page_id limit 1)
    from page_keys k where k.page_id is not null
  ), pages as (
    select k.page_id id,coalesce((select d.page_name from public.owned_library_daily d
      where d.sync_id=p_sync and d.page_id=k.page_id and (p_unit='' or d.unit_id::text=p_unit) order by d.insight_date desc limit 1),k.page_id) name
    from page_keys k where k.page_id is not null
  )
  select jsonb_build_object('summary',coalesce((select jsonb_agg(to_jsonb(t) order by currency) from totals t),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(data order by ordinal) from cards),'[]'::jsonb),'total',(select count(*) from grouped),
    'filters',jsonb_build_object('units',coalesce((select jsonb_agg(to_jsonb(u) order by name,id) from units u),'[]'::jsonb),
      'pages',coalesce((select jsonb_agg(to_jsonb(p) order by name,id) from pages p),'[]'::jsonb))) into result;
  return result;
end $function$;
revoke all on function public.owned_performance_page(uuid, date, date, text, text, text, text, text, integer) from public, anon;
grant execute on function public.owned_performance_page(uuid, date, date, text, text, text, text, text, integer) to authenticated, service_role;

-- The snapshot already published gets its totals now.
select public.owned_build_ad_totals(id) from public.owned_library_syncs
  where status='completed' and daily_ready order by finished_at desc limit 1;
notify pgrst, 'reload schema';
