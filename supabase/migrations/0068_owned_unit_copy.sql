-- The copy of our ads that had spend in one unit over a period, for the offers-and-prices comparison
-- with that unit's rivals. Same eligibility as owned_performance_units: an ad counts when it has
-- positive spend in the unit on a day in the period. Returns text only; the offers are read in the app.
-- Reads stay narrow on a cold cache: the unit/date index picks the ad keys, then one primary-key
-- lookup per ad for its copy.
create or replace function public.owned_unit_copy(p_sync uuid,p_unit uuid,p_from date,p_to date)
returns table(account_id text,ad_id text,title text,body_text text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if (select public.current_user_role()) is null or (select public.current_user_role()) not in ('analyst','admin') then
    raise exception 'Analyst authorization required' using errcode='42501';
  end if;
  if p_unit is null or p_from is null or p_to is null or p_from>p_to or p_to-p_from>400 then
    raise exception 'Invalid period' using errcode='22023';
  end if;
  if not exists(select 1 from public.owned_library_syncs where id=p_sync and status='completed' and daily_ready) then
    raise exception 'Completed daily snapshot required' using errcode='22023';
  end if;
  return query
    with live as (
      select distinct d.account_id,d.ad_id from public.owned_library_daily d
       where d.sync_id=p_sync and d.unit_id=p_unit and d.insight_date between p_from and p_to and d.spend>0
    )
    select a.account_id,a.ad_id,a.data->>'title',a.data->>'body_text'
      from live l join public.owned_library_ads a on a.sync_id=p_sync and a.account_id=l.account_id and a.ad_id=l.ad_id;
end $$;
revoke all on function public.owned_unit_copy(uuid,uuid,date,date) from public,anon;
grant execute on function public.owned_unit_copy(uuid,uuid,date,date) to authenticated;
comment on function public.owned_unit_copy(uuid,uuid,date,date) is 'Copy of our ads with spend in one unit over a period; the offers comparison reads offers from it in the app.';
notify pgrst,'reload schema';
