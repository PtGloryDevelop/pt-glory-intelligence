-- Command Center, same answer for less work (9 Oct). 0062 built a full card (ad data merged into jsonb)
-- for every ad in the period, ~11,000 for "all time", to keep 10 per ranking; cold, right after a sync,
-- that took 9.6 s against the 8 s statement timeout and the page lost its falling strip. Now the rankings
-- are picked on numbers first and only the winners (at most 40) are joined to their ad data. The daily
-- rows carry only the columns used, and sorts get room in memory instead of spilling to disk.
-- Inputs, rules, output shape and grants are unchanged (see 0062).
create or replace function public.owned_command_center(
  p_sync uuid,p_from date,p_to date,p_unit text,p_page_id text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set plan_cache_mode=force_custom_plan set work_mem='32MB' as $$
declare result jsonb; v_to date;
begin
  if (select public.current_user_role()) is null or (select public.current_user_role()) not in ('analyst','admin') then
    raise exception 'Analyst authorization required' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_from>p_to or p_from<date '0001-01-01' or p_to>date '9999-12-31'
    or p_unit is null or (p_unit<>'' and p_unit !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or p_page_id is null or (p_page_id<>'' and p_page_id !~ '^[0-9]{1,32}$') then
    raise exception 'Invalid command center filters' using errcode='22023';
  end if;
  select daily_to into v_to from public.owned_library_syncs where id=p_sync and status='completed' and daily_ready;
  if v_to is null then raise exception 'Completed daily snapshot required' using errcode='22023'; end if;
  with days as materialized (
    select d.account_id,d.ad_id,d.insight_date,d.unit_id,d.unit_name,d.spend,d.conversations,d.purchases,d.purchase_value
    from public.owned_library_daily d
    where d.sync_id=p_sync and d.currency='THB' and (p_page_id='' or d.page_id=p_page_id)
      and d.insight_date between least(p_from,v_to-13) and greatest(p_to,v_to)
  ), period as materialized (
    select account_id,ad_id,
      coalesce(array_agg(distinct unit_id::text) filter(where unit_id is not null),'{}'::text[]) unit_ids,
      coalesce(array_agg(distinct unit_name) filter(where unit_name is not null),'{}'::text[]) unit_names,
      case when count(spend)=count(*) then sum(spend) end spend,
      case when count(conversations)=count(*) then sum(conversations) end conversations,
      case when count(purchases)=count(*) then sum(purchases) end purchases,
      case when count(purchase_value)=count(*) then sum(purchase_value) end purchase_value,
      case when count(spend)=count(*) and count(purchase_value)=count(*) and sum(spend)>0 then sum(purchase_value)/sum(spend) end roas,
      case when count(spend)=count(*) and count(conversations)=count(*) and sum(conversations)>0 then sum(spend)/sum(conversations) end cost_per_conversation
    from days where insight_date between p_from and p_to and (p_unit='' or unit_id::text=p_unit)
    group by account_id,ad_id having sum(spend)>0
  ), picked as materialized (
    -- Winners on numbers alone. "Oldest" needs Meta's created_time, which lives in the ad data,
    -- so it reads that one field for the ads with 1,000+ spend only.
    (select 'sales' list,account_id,ad_id from period where purchase_value>0 order by purchase_value desc,account_id,ad_id limit 10)
    union all
    (select 'cheap_chats',account_id,ad_id from period where conversations>=30 and cost_per_conversation is not null order by cost_per_conversation,account_id,ad_id limit 10)
    union all
    (select 'top_roas',account_id,ad_id from period where spend>=1000 and roas is not null order by roas desc,account_id,ad_id limit 10)
    union all
    (select 'oldest',p.account_id,p.ad_id from period p join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=p.account_id and a.ad_id=p.ad_id
      where p.spend>=1000 and a.data->>'created_time' is not null
      order by (a.data->>'created_time')::timestamptz,p.account_id,p.ad_id limit 10)
  ), cards as materialized (
    select k.list,p.*,a.data->>'created_time' created_text,
      coalesce(a.data,'{}'::jsonb)||jsonb_build_object('account_id',p.account_id,'ad_id',p.ad_id,'currency','THB','status',a.status,
        'unit_ids',p.unit_ids,'unit_names',p.unit_names,'spend',p.spend,'conversations',p.conversations,'purchases',p.purchases,
        'purchase_value',p.purchase_value,'roas',p.roas,'cost_per_conversation',p.cost_per_conversation) card
    from picked k join period p on p.account_id=k.account_id and p.ad_id=k.ad_id
    left join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=p.account_id and a.ad_id=p.ad_id
  ), windows as materialized (
    select account_id,ad_id,
      (array_agg(unit_id::text order by insight_date desc) filter(where unit_id is not null))[1] unit_id,
      (array_agg(unit_name order by insight_date desc) filter(where unit_name is not null))[1] unit_name,
      sum(spend) filter(where insight_date between v_to-6 and v_to) recent_spend,
      sum(purchase_value) filter(where insight_date between v_to-6 and v_to) recent_value,
      sum(spend) filter(where insight_date between v_to-13 and v_to-7) previous_spend,
      sum(purchase_value) filter(where insight_date between v_to-13 and v_to-7) previous_value
    from days where insight_date between v_to-13 and v_to group by account_id,ad_id
  ), falling_all as materialized (
    select w.*,w.previous_value/w.previous_spend previous_roas,w.recent_value/w.recent_spend recent_roas from windows w
    where w.previous_spend>=1000 and w.recent_spend>=1000 and w.previous_value is not null and w.recent_value is not null
      and w.previous_value/w.previous_spend>=2.5 and w.recent_value/w.recent_spend<2.5
  ), falling_list as materialized (
    select f.account_id,f.ad_id,f.recent_spend from falling_all f where p_unit='' or f.unit_id=p_unit
  ), falling_cards as materialized (
    -- Cards for the 50 shown; the total still counts them all.
    select f.account_id,f.ad_id,f.recent_spend,coalesce(a.data,'{}'::jsonb)||jsonb_build_object('account_id',f.account_id,'ad_id',f.ad_id,'currency','THB','status',a.status,
      'unit_ids',case when f.unit_id is null then '{}'::text[] else array[f.unit_id] end,
      'unit_names',case when f.unit_name is null then '{}'::text[] else array[f.unit_name] end,
      'spend',f.recent_spend,'previous_spend',f.previous_spend,'recent_spend',f.recent_spend,
      'previous_roas',f.previous_roas,'recent_roas',f.recent_roas) card
    from (select l.account_id,l.ad_id from falling_list l order by l.recent_spend desc,l.account_id,l.ad_id limit 50) top
    join falling_all f on f.account_id=top.account_id and f.ad_id=top.ad_id
    left join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=f.account_id and a.ad_id=f.ad_id
  )
  select jsonb_build_object(
    'windows',jsonb_build_object('recent',jsonb_build_object('from',v_to-6,'to',v_to),'previous',jsonb_build_object('from',v_to-13,'to',v_to-7)),
    'falling_counts',coalesce((select jsonb_agg(jsonb_build_object('unit_id',unit_id,'count',n)) from (select unit_id,count(*) n from falling_all group by unit_id) c),'[]'::jsonb),
    'falling_total',(select count(*) from falling_list),
    'falling',coalesce((select jsonb_agg(card order by recent_spend desc,account_id,ad_id) from falling_cards),'[]'::jsonb),
    'sales',coalesce((select jsonb_agg(card order by purchase_value desc,account_id,ad_id) from cards where list='sales'),'[]'::jsonb),
    'cheap_chats',coalesce((select jsonb_agg(card order by cost_per_conversation,account_id,ad_id) from cards where list='cheap_chats'),'[]'::jsonb),
    'top_roas',coalesce((select jsonb_agg(card order by roas desc,account_id,ad_id) from cards where list='top_roas'),'[]'::jsonb),
    'oldest',coalesce((select jsonb_agg(card order by created_text::timestamptz,account_id,ad_id) from cards where list='oldest'),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.owned_command_center(uuid,date,date,text,text) from public,anon;
grant execute on function public.owned_command_center(uuid,date,date,text,text) to authenticated;
comment on function public.owned_command_center(uuid,date,date,text,text) is 'Command Center for analysts. THB only. Falling uses fixed windows ending at the snapshot daily_to (latest 7 vs previous 7 days): previous ROAS >= 2.5, latest < 2.5, spend >= 1,000 in both; falling_counts ignore the unit filter. Rankings use the selected period and filters: sales by Meta purchase value; cheapest cost per chat from 30 chats; ROAS and oldest (Meta created_time) from 1,000 spend. Ratios use summed totals; CRM close rate is unavailable. Rankings are picked before ad data is joined (0063).';
notify pgrst,'reload schema';
