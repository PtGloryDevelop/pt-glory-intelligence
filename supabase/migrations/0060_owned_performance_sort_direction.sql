-- Sort direction toggle: p_sort may carry ':asc' or ':desc'. Signature, grants and default order are unchanged.
create or replace function public.owned_performance_page(
  p_sync uuid,p_from date,p_to date,p_unit text,p_page_id text,p_search text,p_sort text,p_status text,p_page integer
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
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
    or p_sort is null or p_sort !~ '^(spend|cost_per_conversation|roas|conversations|hook_rate|newest|longest)(:(asc|desc))?$'
    or p_status is null or p_status not in ('','ACTIVE','PAUSED','CAMPAIGN_PAUSED','ADSET_PAUSED','ARCHIVED','DELETED','DISAPPROVED','WITH_ISSUES')
    or p_page is null or p_page<0 or p_page>100000 then
    raise exception 'Invalid performance filters' using errcode='22023';
  end if;
  -- No suffix keeps each sort's 0053 direction: cheapest cost per chat first, largest first for the rest.
  v_desc := case split_part(p_sort,':',2) when 'asc' then false when 'desc' then true else v_sort<>'cost_per_conversation' end;
  if not exists(select 1 from public.owned_library_syncs where id=p_sync and status='completed' and daily_ready) then
    raise exception 'Completed daily snapshot required' using errcode='22023';
  end if;
  -- ponytail: short/punctuation queries scan stored text; add a short-text index only if measured load warrants it.
  with matching_ads as not materialized (select account_id,ad_id,status from public.owned_library_ads where sync_id=p_sync and (p_search='' or (case when p_search ~ '[[:alnum:]]{3}' then search_text else search_text||'' end) ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%' escape '\') and (p_status='' or status=p_status)), candidates as materialized (
    select d.* from public.owned_library_daily d
    left join matching_ads a on a.account_id=d.account_id and a.ad_id=d.ad_id
    where d.sync_id=p_sync and d.insight_date between p_from and p_to
      and (p_unit='' or d.unit_id::text=p_unit) and (p_page_id='' or d.page_id=p_page_id)
      and (p_status='' or a.status=p_status)
      and (p_search='' or a.ad_id is not null or case when (d.ad_id||' '||d.ad_name||' '||coalesce(d.page_name,'')||'  ') ilike '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%' escape '\' then not exists(select 1 from public.owned_library_ads inventory where inventory.sync_id=d.sync_id and inventory.account_id=d.account_id and inventory.ad_id=d.ad_id) else false end)
  ), days as materialized (
    -- Keep every contributing day for an eligible ad, including null metrics;
    -- filtering to only positive daily rows would hide missing totals.
    select c.* from candidates c where exists(select 1 from candidates e
      where e.account_id=c.account_id and e.ad_id=c.ad_id and e.currency=c.currency and e.spend>0)
  ), grouped as materialized (
    select account_id,ad_id,currency,
      (array_agg(ad_name order by insight_date desc))[1] ad_name,
      (array_agg(page_id order by insight_date desc))[1] page_id,
      (array_agg(page_name order by insight_date desc))[1] page_name,
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
      case when v_sort='newest' then (select min(h.insight_date) from public.owned_library_daily h
        where h.sync_id=p_sync and h.account_id=d.account_id and h.ad_id=d.ad_id and h.spend>0) end delivery_first,
      max(insight_date) filter(where spend>0) delivery_last,
      case when count(spend)=count(*) then count(*) filter(where spend>0) end delivery_days
    from days d group by account_id,ad_id,currency
  ), totals as (
    select currency,count(*) daily_rows,(select count(*) from grouped g where g.currency=d.currency) ad_count,
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
      account_id,ad_id) ordinal
    from grouped g cross join lateral (select case v_sort
      when 'spend' then g.spend when 'cost_per_conversation' then g.cost_per_conversation when 'roas' then g.roas
      when 'conversations' then g.conversations::numeric when 'hook_rate' then g.hook_rate
      when 'newest' then (g.delivery_first-date '2000-01-01')::numeric when 'longest' then g.delivery_days::numeric end sort_key) k
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
      'delivery_first',coalesce(g.delivery_first,(select min(h.insight_date) from public.owned_library_daily h
        where h.sync_id=p_sync and h.account_id=g.account_id and h.ad_id=g.ad_id and h.spend>0)),
      'delivery_last',g.delivery_last,'delivery_days',g.delivery_days
    ) data,g.ordinal
    from page g left join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=g.account_id and a.ad_id=g.ad_id
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
revoke all on function public.owned_performance_page(uuid,date,date,text,text,text,text,text,integer) from public,anon;
grant execute on function public.owned_performance_page(uuid,date,date,text,text,text,text,text,integer) to authenticated;
comment on function public.owned_performance_page(uuid,date,date,text,text,text,text,text,integer) is 'Only ads with known positive spend in the selected period are eligible; summary includes all their contributing days. Status is latest inventory state, not historical daily state. Ratios use summed totals and require every ad/day to supply both fields. Hook uses Meta video_view actions / impressions. CRM close rate is unavailable. Delivery first is earliest positive-spend date in imported history, not lifetime start; delivery days count positive-spend dates in the selected period. Sort accepts an optional :asc or :desc suffix; nulls always sort last.';
notify pgrst,'reload schema';
