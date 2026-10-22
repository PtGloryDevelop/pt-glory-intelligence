-- The copy of a page's running ads in each of the two latest collection rounds that saw the page, so the
-- offers written in it can be compared round to round (0070). A round only shows the ads its search
-- returned, so the comparison is between what each round saw, not the page's whole output.
-- SECURITY INVOKER like every other page read: RLS decides which rows come back.
create or replace function public.page_offer_rounds(p_page_id text)
returns table(collection_run_id uuid,collected_at timestamptz,ad_archive_id text,title text,body_text text)
language sql stable security invoker set search_path=public,pg_temp as $$
  with page_obs as (
    select o.collection_run_id,o.is_active,o.title,o.body_text,a.ad_archive_id
      from public.ad_observations o
      join public.ads a on a.id=o.ad_ref
      join public.pages p on p.id=a.page_ref
     where p.page_id=p_page_id
  ), rounds as (
    select cr.id,cr.collected_at from public.collection_runs cr
     where cr.id in (select distinct po.collection_run_id from page_obs po)
     order by cr.collected_at desc limit 2
  )
  select r.id,r.collected_at,po.ad_archive_id,po.title,po.body_text
    from rounds r join page_obs po on po.collection_run_id=r.id
   where po.is_active is true
$$;
revoke all on function public.page_offer_rounds(text) from public,anon;
grant execute on function public.page_offer_rounds(text) to authenticated;
comment on function public.page_offer_rounds(text) is 'Running ads'' copy from the two latest rounds that saw a page, for round-to-round offer changes.';
notify pgrst,'reload schema';
