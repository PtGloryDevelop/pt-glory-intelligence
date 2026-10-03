-- Existing five-argument RPC remains compatible; this version also filters reported spend.
-- ILIKE is not leakproof: RLS prevents the trigram index from serving it.
-- This narrowly scoped RPC checks the financial role and completed snapshot
-- before executing the indexed read. Direct table access retains RLS.
create function public.owned_library_filtered_page(p_sync uuid,p_search text,p_account text,p_status text,p_page integer,p_has_spend boolean)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if public.current_user_role() is null or public.current_user_role() not in ('analyst','admin') then
    raise exception 'Analyst authorization required' using errcode='42501';
  end if;
  if p_page is null or p_page<0 or p_page>100000 or p_search is null or length(p_search)>160
    or p_account is null or length(p_account)>128 or p_status is null or length(p_status)>64 or p_has_spend is null then
    raise exception 'Invalid filters' using errcode='22023';
  end if;
  if not exists(select 1 from public.owned_library_syncs where id=p_sync and status='completed') then
    raise exception 'Completed snapshot required' using errcode='22023';
  end if;
  with matching as materialized (
    select data,spend,account_id,ad_id from public.owned_library_ads
    where sync_id=p_sync and (not p_has_spend or spend>0) and (p_account='' or account_id=p_account) and (p_status='' or status=p_status)
      and (p_search='' or search_text ilike '%' || replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_') || '%' escape '\')
  ), page as (
    select data from matching order by spend desc nulls last,account_id,ad_id limit 24 offset p_page*24
  )
  select jsonb_build_object('total',(select count(*) from matching),'rows',coalesce((select jsonb_agg(data) from page),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.owned_library_filtered_page(uuid,text,text,text,integer,boolean) from public,anon;
grant execute on function public.owned_library_filtered_page(uuid,text,text,text,integer,boolean) to authenticated;
notify pgrst,'reload schema';
