-- Our ads by creative, all imported days in time (0075). owned_media_page copied every daily row through three
-- materialized steps and sorted ~90k wide rows by creative, spilling to disk; on the pilot's database the all-days
-- view took 8-16 s and the 8 s statement limit turned it into an error. Each ad's days are now summed once, read
-- in key order from the primary key, and creatives are built from those ~11k rows; only "days with spend" reads
-- the days again, through the partial spend index. Same filters, sorts and output: on 28 Oct, 27 cases (every sort
-- both ways, pages, unit, page, search, status, 1/7/14/all days) returned identical JSON; all days took ~1-4 s.
CREATE OR REPLACE FUNCTION public.owned_media_page(p_sync uuid, p_from date, p_to date, p_unit text, p_page_id text, p_search text, p_sort text, p_status text, p_page integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
 SET work_mem TO '32MB'
AS $function$
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
  with recursive matching_ads as not materialized (select account_id,ad_id,status from public.owned_library_ads where sync_id=p_sync and (p_search='' or (case when p_search ~ '[[:alnum:]]{3}' then search_text else search_text||'' end) ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%' escape '\') and (p_status='' or status=p_status)), candidates as not materialized (
    select d.account_id,d.ad_id,d.currency,d.insight_date,d.ad_name,d.page_id,d.page_name,d.unit_id,d.unit_name,
      d.spend,d.impressions,d.clicks,d.conversations,d.purchases,d.purchase_value,d.video_3s,d.thruplays,d.video_views
    from public.owned_library_daily d
    left join matching_ads a on a.account_id=d.account_id and a.ad_id=d.ad_id
    where d.sync_id=p_sync and d.insight_date between p_from and p_to
      and (p_unit='' or d.unit_id::text=p_unit) and (p_page_id='' or d.page_id=p_page_id)
      and (p_status='' or a.status=p_status)
      and (p_search='' or a.ad_id is not null or case when (d.ad_id||' '||d.ad_name||' '||coalesce(d.page_name,'')||'  ') ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%' escape '\' then not exists(select 1 from public.owned_library_ads inventory where inventory.sync_id=p_sync and inventory.account_id=d.account_id and inventory.ad_id=d.ad_id) else false end)
  ), per_ad as materialized (
    -- One row per ad and currency: its days summed once, so nothing below carries every daily row (the all-days
    -- page sorted ~90k wide rows by creative and spilled to disk). The metrics are numeric, so summing per ad and
    -- then per creative gives the same figures. An ad counts only if it spent on some day of the period.
    select account_id,ad_id,currency,count(*) n,
      count(spend) n_spend,sum(spend) spend,count(impressions) n_impressions,sum(impressions) impressions,
      count(clicks) n_clicks,sum(clicks) clicks,count(conversations) n_conversations,sum(conversations) conversations,
      count(purchases) n_purchases,sum(purchases) purchases,count(purchase_value) n_purchase_value,sum(purchase_value) purchase_value,
      count(video_3s) n_video_3s,sum(video_3s) video_3s,count(thruplays) n_thruplays,sum(thruplays) thruplays,
      count(video_views) n_video_views,sum(video_views) video_views,
      count(*) filter(where spend is not null and purchase_value is not null) n_roas,
      count(*) filter(where video_views is not null and impressions is not null) n_hook,
      max(insight_date) filter(where spend>0) delivery_last,
      array_agg(distinct unit_id::text) filter(where unit_id is not null) unit_ids,
      array_agg(distinct unit_name) filter(where unit_name is not null) unit_names,
      (array_agg(ad_name order by insight_date desc))[1] ad_name,
      (array_agg(page_id order by insight_date desc))[1] page_id,
      (array_agg(page_name order by insight_date desc))[1] page_name
    from candidates group by account_id,ad_id,currency having bool_or(spend>0)
  ), ad_keys as materialized (
    select x.account_id,x.ad_id,coalesce(a.media_key,'a:'||x.account_id||':'||x.ad_id) media_key,a.meta_created_time,a.status
    from (select distinct account_id,ad_id from per_ad) x
    left join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=x.account_id and a.ad_id=x.ad_id
  ), keyed as materialized (
    select p.*,k.media_key from per_ad p join ad_keys k on k.account_id=p.account_id and k.ad_id=p.ad_id
  ), ad_counts as materialized (
    select currency,count(*) ad_count from per_ad group by currency
  ), spend_days as materialized (
    -- Calendar days on which any of the creative's ads spent: the one figure that needs the days themselves.
    select k.media_key,c.currency,count(distinct c.insight_date) days
    from candidates c join ad_keys k on k.account_id=c.account_id and k.ad_id=c.ad_id
    where c.spend>0 group by k.media_key,c.currency
  ), media_units as materialized (
    select k.media_key,k.currency,array_agg(distinct u.id) unit_ids from keyed k cross join lateral unnest(k.unit_ids) u(id) group by 1,2
  ), media_unit_names as materialized (
    select k.media_key,k.currency,array_agg(distinct u.name) unit_names from keyed k cross join lateral unnest(k.unit_names) u(name) group by 1,2
  ), sums as materialized (
    select media_key,currency,count(*) ad_count,count(distinct account_id) account_count,sum(n_spend)=sum(n) spend_complete,
      case when sum(n_spend)=sum(n) then sum(spend) end spend,
      case when sum(n_impressions)=sum(n) then sum(impressions) end impressions,
      case when sum(n_clicks)=sum(n) then sum(clicks) end clicks,
      case when sum(n_conversations)=sum(n) then sum(conversations) end conversations,
      case when sum(n_purchases)=sum(n) then sum(purchases) end purchases,
      case when sum(n_purchase_value)=sum(n) then sum(purchase_value) end purchase_value,
      case when sum(n_video_3s)=sum(n) then sum(video_3s) end video_3s,
      case when sum(n_thruplays)=sum(n) then sum(thruplays) end thruplays,
      case when sum(n_spend)=sum(n) and sum(n_purchase_value)=sum(n) and sum(spend)>0 then sum(purchase_value)/sum(spend) end roas,
      case when sum(n_spend)=sum(n) and sum(n_conversations)=sum(n) and sum(conversations)>0 then sum(spend)/sum(conversations) end cost_per_conversation,
      case when sum(n_video_views)=sum(n) and sum(n_impressions)=sum(n) and sum(impressions)>0 then sum(video_views)/sum(impressions) end hook_rate,
      max(delivery_last) delivery_last
    from keyed group by media_key,currency
  ), grouped as materialized (
    select s.media_key,s.currency,s.ad_count,s.account_count,
      coalesce(mu.unit_ids,'{}'::text[]) unit_ids,coalesce(mn.unit_names,'{}'::text[]) unit_names,
      s.spend,s.impressions,s.clicks,s.conversations,s.purchases,s.purchase_value,s.video_3s,s.thruplays,
      s.roas,s.cost_per_conversation,s.hook_rate,s.delivery_last,
      -- Calendar days on which any of the creative's ads spent.
      case when s.spend_complete then coalesce(d.days,0) end delivery_days
    from sums s
    left join media_units mu on mu.media_key=s.media_key and mu.currency=s.currency
    left join media_unit_names mn on mn.media_key=s.media_key and mn.currency=s.currency
    left join spend_days d on d.media_key=s.media_key and d.currency=s.currency
  ), first_spend as materialized (
    -- Only the "newest" sort needs this for every creative; the page fills it for its own rows below.
    select k.media_key,min(h.insight_date) first_date from ad_keys k
    join public.owned_library_daily h on h.sync_id=p_sync and h.account_id=k.account_id and h.ad_id=k.ad_id and h.spend>0
    where v_sort='newest' group by k.media_key
  ), totals as (
    select currency,sum(n)::bigint daily_rows,(select ad_count from ad_counts x where x.currency=d.currency) ad_count,
      (select count(*) from grouped g where g.currency=d.currency) media_count,
      case when sum(n_spend)=sum(n) then sum(spend) end spend,
      case when sum(n_conversations)=sum(n) then sum(conversations) end conversations,
      case when sum(n_purchases)=sum(n) then sum(purchases) end purchases,
      case when sum(n_purchase_value)=sum(n) then sum(purchase_value) end purchase_value,
      case when sum(n_impressions)=sum(n) then sum(impressions) end impressions,
      case when sum(n_video_views)=sum(n) then sum(video_views) end video_views,
      case when sum(n_spend)=sum(n) and sum(n_purchase_value)=sum(n) and sum(spend)>0 then sum(purchase_value)/sum(spend) end roas,
      case when sum(n_spend)=sum(n) and sum(n_conversations)=sum(n) and sum(conversations)>0 then sum(spend)/sum(conversations) end cost_per_conversation,
      case when sum(n_video_views)=sum(n) and sum(n_impressions)=sum(n) and sum(impressions)>0 then sum(video_views)/sum(impressions) end hook_rate,
      jsonb_build_object(
        'spend',jsonb_build_object('present',sum(n_spend)::bigint,'total',sum(n)::bigint),
        'conversations',jsonb_build_object('present',sum(n_conversations)::bigint,'total',sum(n)::bigint),
        'purchase_value',jsonb_build_object('present',sum(n_purchase_value)::bigint,'total',sum(n)::bigint),
        'roas',jsonb_build_object('present',sum(n_roas)::bigint,'total',sum(n)::bigint),
        'hook_rate',jsonb_build_object('present',sum(n_hook)::bigint,'total',sum(n)::bigint)
      ) coverage,
      null::numeric close_rate
    from per_ad d group by currency
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
    select k.media_key,k.currency,k.account_id,k.ad_id,k.spend,k.ad_name,k.page_id,k.page_name
    from keyed k join page p on p.media_key=k.media_key and p.currency=k.currency
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
  ), unit_keys(unit_id) as (
    -- A loose index scan: one probe per unit on (sync_id,unit_id,insight_date) instead of reading every
    -- daily row of the snapshot, which on a cold cache cost one heap read per row.
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
end $function$
;
notify pgrst,'reload schema';
