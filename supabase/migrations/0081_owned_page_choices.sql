-- 0081 — the page filter lists the pages the ads list can show for the chosen unit and period (25 Nov).
--
-- The page list came from every daily row of the snapshot, back to its first day, narrowed by unit only. A page
-- that had left a unit stayed in that unit's list: on 25 Nov "U9 ลาว" still listed "Levonglow Th-ชาแม่แย้มเพื่อสุขภาพ",
-- whose ads count under U24 since early November, and choosing it emptied "ผลแอดเรา" over the last 3 days with
-- no reason given.
--
-- The list now holds the pages with a day of spend in the period under the chosen unit: the ads list counts an
-- ad only if it spent on some day of the period (`having bool_or(spend>0)`), so these are the pages that can
-- show something. Search and status do not narrow it, as before. The chosen page is always kept, marked
-- in_period=false when it has no spend, so the picker still shows what is chosen; for it, `elsewhere` names
-- the units it did spend under in the period (null id: not yet tied to a unit), so the page can say where it went.
--
-- owned_media_page, owned_performance_page and owned_performance_page_live still return their own
-- snapshot-wide `filters.pages`; getOwnedPerformance replaces it with this list. They are left as they are
-- rather than copied whole three times for a few lines each.
--
-- Measured read-only on the pilot data before applying: 50-150 ms for U9 ลาว (3 days and all days), no unit
-- (51 pages in 3 days, 84 over all days). Same loose index scan for the unit's pages as before, then one probe
-- per page on (sync_id,page_id,insight_date).
CREATE OR REPLACE FUNCTION public.owned_page_choices(p_sync uuid, p_from date, p_to date, p_unit text, p_page_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result jsonb;
begin
  if (select public.current_user_role()) is null or (select public.current_user_role()) not in ('analyst','admin') then
    raise exception 'Analyst authorization required' using errcode='42501';
  end if;
  if p_sync is null or p_from is null or p_to is null or p_from>p_to
    or p_unit is null or (p_unit<>'' and p_unit !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or p_page_id is null or (p_page_id<>'' and p_page_id !~ '^[0-9]{1,32}$') then
    raise exception 'Invalid performance filters' using errcode='22023';
  end if;
  with recursive page_keys(page_id) as (
    -- The unit's pages over the whole snapshot, one index probe per page (0067).
    (select d.page_id from public.owned_library_daily d where d.sync_id=p_sync and d.page_id is not null
      and (p_unit='' or d.unit_id::text=p_unit) order by d.page_id limit 1)
    union all
    select (select d.page_id from public.owned_library_daily d where d.sync_id=p_sync and d.page_id>k.page_id
      and (p_unit='' or d.unit_id::text=p_unit) order by d.page_id limit 1)
    from page_keys k where k.page_id is not null
  ), spent as (
    select k.page_id,exists(select 1 from public.owned_library_daily d where d.sync_id=p_sync and d.page_id=k.page_id
      and d.insight_date between p_from and p_to and d.spend>0 and (p_unit='' or d.unit_id::text=p_unit)) in_period
    from page_keys k where k.page_id is not null
  ), chosen as (
    select page_id,in_period from spent where in_period or page_id=p_page_id
    union all
    -- A chosen page that never was in this unit (a link from elsewhere) is still shown as chosen.
    select p_page_id,false where p_page_id<>'' and not exists(select 1 from spent where page_id=p_page_id)
  ), named as (
    select c.page_id id,c.in_period,coalesce(
      (select d.page_name from public.owned_library_daily d where d.sync_id=p_sync and d.page_id=c.page_id
        and (p_unit='' or d.unit_id::text=p_unit) order by d.insight_date desc limit 1),
      (select d.page_name from public.owned_library_daily d where d.sync_id=p_sync and d.page_id=c.page_id
        order by d.insight_date desc limit 1),
      c.page_id) name
    from chosen c
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'name',n.name,'in_period',n.in_period,
      'elsewhere',case when not n.in_period and p_unit<>'' then coalesce((select jsonb_agg(distinct jsonb_build_object('id',d.unit_id,'name',d.unit_name))
        from public.owned_library_daily d where d.sync_id=p_sync and d.page_id=n.id and d.insight_date between p_from and p_to
          and d.spend>0 and d.unit_id::text is distinct from p_unit),'[]'::jsonb) end)
    order by n.name,n.id),'[]'::jsonb) into result
  from named n;
  return result;
end $function$;
revoke all on function public.owned_page_choices(uuid, date, date, text, text) from public, anon;
grant execute on function public.owned_page_choices(uuid, date, date, text, text) to authenticated, service_role;
notify pgrst, 'reload schema';
