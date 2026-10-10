-- One card per creative (10 Oct). Cloned ads keep Meta's video id: in the 9 Oct snapshot 11,587 ads came
-- from about 3,536 creatives ("VDO 242" alone ran as 428 ads). The library groups ads by that id: video id
-- first, then creative id (pictures), else the ad itself. A copy uploaded to another ad account gets a new
-- video id and stays separate; its picture differs as well (checked 9 Oct), so nothing is joined by name.
-- owned_performance_page (one row per ad) is unchanged; these are new functions beside it.
alter table public.owned_library_ads
  add column media_key text generated always as (case
    when coalesce(data->>'video_id','')<>'' then 'v:'||(data->>'video_id')
    when coalesce(data->>'creative_id','')<>'' then 'c:'||(data->>'creative_id')
    else 'a:'||account_id||':'||ad_id end) stored,
  add column meta_created_time text generated always as (data->>'created_time') stored;
create index owned_library_ads_media on public.owned_library_ads(sync_id,media_key);

-- Same filters, sorts, validation and summary as owned_performance_page (0061); rows are creatives.
-- Figures sum every eligible ad of the creative; ratios come from those sums. first_created is Meta's
-- creation time of the creative's earliest ad (creation, not first delivery).
create or replace function public.owned_media_page(
  p_sync uuid,p_from date,p_to date,p_unit text,p_page_id text,p_search text,p_sort text,p_status text,p_page integer
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set plan_cache_mode=force_custom_plan set work_mem='32MB' as $$
declare result jsonb;
  v_sort text := split_part(p_sort,':',1);
  v_desc boolean;
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
  v_desc := case split_part(p_sort,':',2) when 'asc' then false when 'desc' then true else v_sort<>'cost_per_conversation' end;
  if not exists(select 1 from public.owned_library_syncs where id=p_sync and status='completed' and daily_ready) then
    raise exception 'Completed daily snapshot required' using errcode='22023';
  end if;
  with matching_ads as not materialized (select account_id,ad_id,status from public.owned_library_ads where sync_id=p_sync and (p_search='' or (case when p_search ~ '[[:alnum:]]{3}' then search_text else search_text||'' end) ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%' escape '\') and (p_status='' or status=p_status)), candidates as materialized (
    select d.account_id,d.ad_id,d.currency,d.insight_date,d.ad_name,d.page_id,d.page_name,d.unit_id,d.unit_name,
      d.spend,d.impressions,d.clicks,d.conversations,d.purchases,d.purchase_value,d.video_3s,d.thruplays,d.video_views
    from public.owned_library_daily d
    left join matching_ads a on a.account_id=d.account_id and a.ad_id=d.ad_id
    where d.sync_id=p_sync and d.insight_date between p_from and p_to
      and (p_unit='' or d.unit_id::text=p_unit) and (p_page_id='' or d.page_id=p_page_id)
      and (p_status='' or a.status=p_status)
      and (p_search='' or a.ad_id is not null or case when (d.ad_id||' '||d.ad_name||' '||coalesce(d.page_name,'')||'  ') ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%' escape '\' then not exists(select 1 from public.owned_library_ads inventory where inventory.sync_id=p_sync and inventory.account_id=d.account_id and inventory.ad_id=d.ad_id) else false end)
  ), days as materialized (
    select c.* from candidates c where exists(select 1 from candidates e
      where e.account_id=c.account_id and e.ad_id=c.ad_id and e.currency=c.currency and e.spend>0)
  ), ad_keys as materialized (
    select x.account_id,x.ad_id,coalesce(a.media_key,'a:'||x.account_id||':'||x.ad_id) media_key,a.meta_created_time,a.status
    from (select distinct account_id,ad_id from days) x
    left join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=x.account_id and a.ad_id=x.ad_id
  ), keyed as materialized (
    select d.*,k.media_key from days d join ad_keys k on k.account_id=d.account_id and k.ad_id=d.ad_id
  ), ad_counts as materialized (
    select currency,count(*) ad_count from (select distinct currency,account_id,ad_id from days) x group by currency
  ), grouped as materialized (
    select media_key,currency,
      count(distinct account_id||':'||ad_id) ad_count,
      count(distinct account_id) account_count,
      coalesce(array_agg(distinct unit_id::text) filter(where unit_id is not null),'{}'::text[]) unit_ids,
      coalesce(array_agg(distinct unit_name) filter(where unit_name is not null),'{}'::text[]) unit_names,
      case when count(spend)=count(*) then sum(spend) end spend,
      case when count(impressions)=count(*) then sum(impressions) end impressions,
      case when count(clicks)=count(*) then sum(clicks) end clicks,
      case when count(conversations)=count(*) then sum(conversations) end conversations,
      case when count(purchases)=count(*) then sum(purchases) end purchases,
      case when count(purchase_value)=count(*) then sum(purchase_value) end purchase_value,
      case when count(video_3s)=count(*) then sum(video_3s) end video_3s,
      case when count(thruplays)=count(*) then sum(thruplays) end thruplays,
      case when count(spend)=count(*) and count(purchase_value)=count(*) and sum(spend)>0 then sum(purchase_value)/sum(spend) end roas,
      case when count(spend)=count(*) and count(conversations)=count(*) and sum(conversations)>0 then sum(spend)/sum(conversations) end cost_per_conversation,
      case when count(video_views)=count(*) and count(impressions)=count(*) and sum(impressions)>0 then sum(video_views)/sum(impressions) end hook_rate,
      max(insight_date) filter(where spend>0) delivery_last,
      -- Calendar days on which any of the creative's ads spent.
      case when count(spend)=count(*) then count(distinct insight_date) filter(where spend>0) end delivery_days
    from keyed group by media_key,currency
  ), first_spend as materialized (
    -- Only the "newest" sort needs this for every creative; the page fills it for its own rows below.
    select k.media_key,min(h.insight_date) first_date from ad_keys k
    join public.owned_library_daily h on h.sync_id=p_sync and h.account_id=k.account_id and h.ad_id=k.ad_id and h.spend>0
    where v_sort='newest' group by k.media_key
  ), totals as (
    select currency,count(*) daily_rows,(select ad_count from ad_counts x where x.currency=d.currency) ad_count,
      (select count(*) from grouped g where g.currency=d.currency) media_count,
      case when count(spend)=count(*) then sum(spend) end spend,
      case when count(conversations)=count(*) then sum(conversations) end conversations,
      case when count(purchases)=count(*) then sum(purchases) end purchases,
      case when count(purchase_value)=count(*) then sum(purchase_value) end purchase_value,
      case when count(impressions)=count(*) then sum(impressions) end impressions,
      case when count(video_views)=count(*) then sum(video_views) end video_views,
      case when count(spend)=count(*) and count(purchase_value)=count(*) and sum(spend)>0 then sum(purchase_value)/sum(spend) end roas,
      case when count(spend)=count(*) and count(conversations)=count(*) and sum(conversations)>0 then sum(spend)/sum(conversations) end cost_per_conversation,
      case when count(video_views)=count(*) and count(impressions)=count(*) and sum(impressions)>0 then sum(video_views)/sum(impressions) end hook_rate,
      jsonb_build_object(
        'spend',jsonb_build_object('present',count(spend),'total',count(*)),
        'conversations',jsonb_build_object('present',count(conversations),'total',count(*)),
        'purchase_value',jsonb_build_object('present',count(purchase_value),'total',count(*)),
        'roas',jsonb_build_object('present',count(*) filter(where spend is not null and purchase_value is not null),'total',count(*)),
        'hook_rate',jsonb_build_object('present',count(*) filter(where video_views is not null and impressions is not null),'total',count(*))
      ) coverage,
      null::numeric close_rate
    from days d group by currency
  ), ranked as (
    select g.*,row_number() over (order by currency,
      case when v_desc then sort_key end desc nulls last,
      case when not v_desc then sort_key end asc nulls last,
      g.media_key) ordinal
    from grouped g left join first_spend f on f.media_key=g.media_key cross join lateral (select case v_sort
      when 'spend' then g.spend when 'cost_per_conversation' then g.cost_per_conversation when 'roas' then g.roas
      when 'conversations' then g.conversations::numeric when 'hook_rate' then g.hook_rate
      when 'newest' then (f.first_date-date '2000-01-01')::numeric when 'longest' then g.delivery_days::numeric
      when 'close_rate' then case when g.conversations>=30 then g.purchases::numeric/g.conversations end end sort_key) k
  ), page as (
    select * from ranked order by ordinal
    limit 24 offset p_page*24
  ), page_ads as materialized (
    -- The page's creatives only, per ad: picks the face of each card.
    select k.media_key,k.currency,k.account_id,k.ad_id,sum(k.spend) spend,
      (array_agg(k.ad_name order by k.insight_date desc))[1] ad_name,
      (array_agg(k.page_id order by k.insight_date desc))[1] page_id,
      (array_agg(k.page_name order by k.insight_date desc))[1] page_name
    from keyed k join page p on p.media_key=k.media_key and p.currency=k.currency
    group by k.media_key,k.currency,k.account_id,k.ad_id
  ), rep as (
    -- The creative's face on the card: its ad with the most spend in the period.
    select distinct on (x.media_key,x.currency) x.media_key,x.currency,x.account_id,x.ad_id,x.ad_name,x.page_id,x.page_name
    from page_ads x
    order by x.media_key,x.currency,x.spend desc nulls last,x.account_id,x.ad_id
  ), page_meta as (
    select p.media_key,
      (select min(k.meta_created_time::timestamptz) from ad_keys k where k.media_key=p.media_key) first_created,
      (select count(*) from ad_keys k where k.media_key=p.media_key and k.status='ACTIVE') active_ads,
      (select min(h.insight_date) from ad_keys k join public.owned_library_daily h on h.sync_id=p_sync and h.account_id=k.account_id and h.ad_id=k.ad_id and h.spend>0
        where k.media_key=p.media_key) delivery_first
    from page p
  ), cards as (
    select coalesce(a.data,'{}'::jsonb)||jsonb_build_object(
      'account_id',r.account_id,'account_name',coalesce(a.account_name,(select item->>'name' from public.owned_library_syncs s
        cross join lateral jsonb_array_elements(s.accounts) item where s.id=p_sync and item->>'id'=r.account_id),r.account_id),
      'currency',g.currency,'ad_id',r.ad_id,'ad_name',r.ad_name,
      'campaign_name',coalesce(a.campaign_name,'ไม่ทราบแคมเปญ'),'adset_name',a.data->>'adset_name','status',a.status,
      'page_id',r.page_id,'page_name',r.page_name,'title',a.data->>'title','body_text',a.data->>'body_text',
      'creative_url',a.data->>'creative_url','destination_url',a.data->>'destination_url',
      'creative_id',a.data->>'creative_id','video_id',a.data->>'video_id','created_time',a.data->>'created_time',
      'spend',g.spend,'impressions',g.impressions,'clicks',g.clicks,'conversations',g.conversations,
      'purchases',g.purchases,'purchase_value',g.purchase_value,'video_3s',g.video_3s,'thruplays',g.thruplays,
      'unit_ids',g.unit_ids,'unit_names',g.unit_names,'hook_rate',g.hook_rate,'cost_per_conversation',g.cost_per_conversation,
      'delivery_first',m.delivery_first,'delivery_last',g.delivery_last,'delivery_days',g.delivery_days,
      'media_key',g.media_key,'ad_count',g.ad_count,'account_count',g.account_count,'active_ads',m.active_ads,'first_created',m.first_created
    ) data,g.ordinal
    from page g join rep r on r.media_key=g.media_key and r.currency=g.currency
    join page_meta m on m.media_key=g.media_key
    left join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=r.account_id and a.ad_id=r.ad_id
  ), units as (
    select distinct on (unit_id) unit_id::text id,coalesce(unit_name,unit_id::text) name
    from public.owned_library_daily where sync_id=p_sync and unit_id is not null order by unit_id,insight_date desc
  ), pages as (
    select distinct on (page_id) page_id id,coalesce(page_name,page_id) name
    from public.owned_library_daily where sync_id=p_sync and page_id is not null
      and (p_unit='' or unit_id::text=p_unit) order by page_id,insight_date desc
  )
  select jsonb_build_object('summary',coalesce((select jsonb_agg(to_jsonb(t) order by currency) from totals t),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(data order by ordinal) from cards),'[]'::jsonb),'total',(select count(*) from grouped),
    'filters',jsonb_build_object('units',coalesce((select jsonb_agg(to_jsonb(u) order by name,id) from units u),'[]'::jsonb),
      'pages',coalesce((select jsonb_agg(to_jsonb(p) order by name,id) from pages p),'[]'::jsonb))) into result;
  return result;
end $$;
revoke all on function public.owned_media_page(uuid,date,date,text,text,text,text,text,integer) from public,anon;
grant execute on function public.owned_media_page(uuid,date,date,text,text,text,text,text,integer) to authenticated;
comment on function public.owned_media_page(uuid,date,date,text,text,text,text,text,integer) is 'owned_performance_page grouped by creative (owned_library_ads.media_key: video id, else creative id, else the ad). Same filters, sorts and summary (plus media_count). A row sums every eligible ad of the creative in the selected period; ratios use those sums; delivery_days counts calendar days on which any of its ads spent; first_created is the earliest Meta created_time among its eligible ads (creation, not delivery). The card shows the ad with the most spend.';

-- The ads behind one creative card, with the same filters, most spend first (at most 200; total says how many).
create or replace function public.owned_media_members(
  p_sync uuid,p_from date,p_to date,p_unit text,p_page_id text,p_search text,p_status text,p_media_key text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
declare result jsonb;
begin
  if (select public.current_user_role()) is null or (select public.current_user_role()) not in ('analyst','admin') then
    raise exception 'Analyst authorization required' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_from>p_to
    or p_from<date '0001-01-01' or p_to>date '9999-12-31'
    or p_unit is null or (p_unit<>'' and p_unit !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or p_page_id is null or (p_page_id<>'' and p_page_id !~ '^[0-9]{1,32}$')
    or p_search is null or length(p_search)>160
    or p_status is null or p_status not in ('','ACTIVE','PAUSED','CAMPAIGN_PAUSED','ADSET_PAUSED','ARCHIVED','DELETED','DISAPPROVED','WITH_ISSUES')
    or p_media_key is null or p_media_key !~ '^((v|c):[0-9]{1,32}|a:(act_)?[0-9]{1,32}:[0-9]{1,32})$' then
    raise exception 'Invalid media filters' using errcode='22023';
  end if;
  if not exists(select 1 from public.owned_library_syncs where id=p_sync and status='completed' and daily_ready) then
    raise exception 'Completed daily snapshot required' using errcode='22023';
  end if;
  with members as materialized (
    -- The creative's ads in the inventory; an ad with no inventory row is its own creative ("a:" key).
    select account_id,ad_id from public.owned_library_ads where sync_id=p_sync and media_key=p_media_key
      and (p_status='' or status=p_status)
      and (p_search='' or (case when p_search ~ '[[:alnum:]]{3}' then search_text else search_text||'' end) ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%' escape '\')
    union
    select split_part(p_media_key,':',2),split_part(p_media_key,':',3) where p_media_key like 'a:%' and p_status=''
  ), days as materialized (
    select d.* from public.owned_library_daily d join members m on m.account_id=d.account_id and m.ad_id=d.ad_id
    where d.sync_id=p_sync and d.insight_date between p_from and p_to
      and (p_unit='' or d.unit_id::text=p_unit) and (p_page_id='' or d.page_id=p_page_id)
  ), grouped as materialized (
    select account_id,ad_id,currency,
      (array_agg(ad_name order by insight_date desc))[1] ad_name,
      (array_agg(page_name order by insight_date desc))[1] page_name,
      case when count(spend)=count(*) then sum(spend) end spend,
      case when count(conversations)=count(*) then sum(conversations) end conversations,
      case when count(purchases)=count(*) then sum(purchases) end purchases,
      case when count(purchase_value)=count(*) then sum(purchase_value) end purchase_value,
      case when count(spend)=count(*) and count(purchase_value)=count(*) and sum(spend)>0 then sum(purchase_value)/sum(spend) end roas,
      case when count(spend)=count(*) and count(conversations)=count(*) and sum(conversations)>0 then sum(spend)/sum(conversations) end cost_per_conversation,
      case when count(spend)=count(*) then count(*) filter(where spend>0) end delivery_days
    from days group by account_id,ad_id,currency having sum(spend)>0
  )
  select jsonb_build_object('total',(select count(*) from grouped),'rows',coalesce((select jsonb_agg(row order by spend desc nulls last,account_id,ad_id) from (
    select g.spend,g.account_id,g.ad_id,coalesce(a.data,'{}'::jsonb)||jsonb_build_object(
      'account_id',g.account_id,'ad_id',g.ad_id,'currency',g.currency,'ad_name',g.ad_name,'page_name',g.page_name,
      'account_name',coalesce(a.account_name,g.account_id),'campaign_name',coalesce(a.campaign_name,'ไม่ทราบแคมเปญ'),
      'adset_name',a.data->>'adset_name','status',a.status,'created_time',a.data->>'created_time',
      'spend',g.spend,'conversations',g.conversations,'purchases',g.purchases,'purchase_value',g.purchase_value,
      'roas',g.roas,'cost_per_conversation',g.cost_per_conversation,'delivery_days',g.delivery_days) row
    from grouped g left join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=g.account_id and a.ad_id=g.ad_id
    order by g.spend desc nulls last,g.account_id,g.ad_id limit 200) t),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.owned_media_members(uuid,date,date,text,text,text,text,text) from public,anon;
grant execute on function public.owned_media_members(uuid,date,date,text,text,text,text,text) to authenticated;
comment on function public.owned_media_members(uuid,date,date,text,text,text,text,text) is 'Ads behind one owned_media_page row (same media_key and filters), each with its own totals for the period, most spend first; at most 200 rows, total counts all.';
notify pgrst,'reload schema';
