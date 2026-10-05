-- Per-unit totals for one period in a single read (replaces one owned_performance_page call per unit).
-- Same rules as owned_performance_page: an ad counts in a unit when it has positive spend there in the
-- period; all of that ad's days in the unit contribute; a sum is null when any contributing value is null.
-- Unit follows the page assignment on each insight_date; unit_id null is the unassigned group.
create or replace function public.owned_performance_units(p_sync uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if (select public.current_user_role()) is null or (select public.current_user_role()) not in ('analyst','admin') then
    raise exception 'Analyst authorization required' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>400 then
    raise exception 'Invalid period' using errcode='22023';
  end if;
  if not exists(select 1 from public.owned_library_syncs where id=p_sync and status='completed' and daily_ready) then
    raise exception 'Completed daily snapshot required' using errcode='22023';
  end if;
  with days as materialized (
    select d.unit_id,d.unit_name,d.insight_date,d.currency,d.account_id,d.ad_id,d.spend,d.conversations,d.purchase_value,
      bool_or(d.spend>0) over (partition by d.unit_id,d.account_id,d.ad_id,d.currency) eligible
    from public.owned_library_daily d
    where d.sync_id=p_sync and d.insight_date between p_from and p_to
  ), units as (
    select unit_id::text id,(array_agg(unit_name order by insight_date desc) filter(where unit_name is not null))[1] name,currency,
      count(distinct (account_id,ad_id)) ad_count,
      case when count(spend)=count(*) then sum(spend) end spend,
      case when count(conversations)=count(*) then sum(conversations) end conversations,
      case when count(purchase_value)=count(*) then sum(purchase_value) end purchase_value,
      case when count(spend)=count(*) and count(purchase_value)=count(*) and sum(spend)>0 then sum(purchase_value)/sum(spend) end roas,
      case when count(spend)=count(*) and count(conversations)=count(*) and sum(conversations)>0 then sum(spend)/sum(conversations) end cost_per_conversation
    from days where eligible group by unit_id,currency
  )
  select coalesce(jsonb_agg(to_jsonb(u) order by currency,spend desc nulls last),'[]'::jsonb) into result from units u;
  return result;
end $$;
revoke all on function public.owned_performance_units(uuid,date,date) from public,anon;
grant execute on function public.owned_performance_units(uuid,date,date) to authenticated;
comment on function public.owned_performance_units(uuid,date,date) is 'Per-unit (and unassigned) totals for one period; mirrors owned_performance_page eligibility and null rules.';
notify pgrst,'reload schema';
