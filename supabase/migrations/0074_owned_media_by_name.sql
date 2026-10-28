-- One card per clip when Ads Manager duplicates an ad (0074). A duplicated ad gets its own post and its own copy
-- of the video, so the video id (0065) split one clip into several cards: on 28 Oct, 602 ad-name + page groups
-- spanned more than one video id ("VDO 4" of one Menova page alone made 19 cards). The team names each clip
-- ("VDO 4") and duplicates keep its caption, so a named ad now groups by page + ad name + caption; an edited
-- caption stays its own card. Ads without a name or page keep the video, creative, ad order of 0065.
-- Totals do not move: the same ads are summed, only into fewer cards (11,235 ads: 3,594 cards became 2,785).
-- The key is 16 hex of the md5, as short as the video keys: the all-days page sorts every daily row by it.
alter table public.owned_library_ads alter column media_key set expression as (case
  when coalesce(trim(data->>'ad_name'),'')<>'' and coalesce(data->>'page_id','') ~ '^[0-9]{1,32}$'
    then 'n:'||left(md5((data->>'page_id')||chr(31)||lower(regexp_replace(trim(data->>'ad_name'),'\s+',' ','g'))
      ||chr(31)||regexp_replace(trim(coalesce(data->>'body_text','')),'\s+',' ','g')),16)
  when coalesce(data->>'video_id','')<>'' then 'v:'||(data->>'video_id')
  when coalesce(data->>'creative_id','')<>'' then 'c:'||(data->>'creative_id')
  else 'a:'||account_id||':'||ad_id end);

-- The members list accepts the new key; otherwise unchanged from the live definition.
CREATE OR REPLACE FUNCTION public.owned_media_members(p_sync uuid, p_from date, p_to date, p_unit text, p_page_id text, p_search text, p_status text, p_media_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
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
    or p_media_key is null or p_media_key !~ '^((v|c):[0-9]{1,32}|a:(act_)?[0-9]{1,32}:[0-9]{1,32}|n:[0-9a-f]{16})$' then
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
end $function$
;
notify pgrst,'reload schema';

-- The rewrite leaves the new key without statistics; without them the 7-day page took 2.2 s instead of 0.4 s.
analyze public.owned_library_ads;
