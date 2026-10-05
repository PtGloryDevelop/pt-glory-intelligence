-- Restores the 0056 version (ad copy only).
create or replace function public.rival_keyword_pages(p_keywords text[])
returns jsonb language plpgsql stable set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if p_keywords is null or cardinality(p_keywords) > 30 then
    raise exception 'Invalid keywords' using errcode='22023';
  end if;
  with kw as (
    select '%' || replace(replace(replace(k,'\','\\'),'%','\%'),'_','\_') || '%' pat
    from unnest(p_keywords) k where length(btrim(k)) between 2 and 60
  ), latest as (
    select distinct on (o.ad_ref) o.ad_ref, o.title, o.body_text, o.observed_at
    from public.ad_observations o order by o.ad_ref, o.observed_at desc
  ), matched as (
    select a.page_ref, a.id ad_id, coalesce(nullif(l.title,''), left(l.body_text,140)) sample, l.observed_at, a.first_seen_at
    from latest l join public.ads a on a.id = l.ad_ref
    where exists (select 1 from kw where coalesce(l.title,'') || ' ' || coalesce(l.body_text,'') ilike kw.pat escape '\')
  ), per_page as (
    select page_ref, count(distinct ad_id) matched_ads, (array_agg(sample order by observed_at desc))[1] sample,
      count(distinct ad_id) filter (where first_seen_at > now() - interval '7 days') new_matched_7d
    from matched group by page_ref
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'page_id', p.page_id, 'page_name', pn.page_name, 'matched_ads', pp.matched_ads, 'sample', pp.sample, 'new_matched_7d', pp.new_matched_7d,
      'ads_total', s.ads_total, 'active_ads', s.active_ads, 'longest_days', s.longest_days, 'last_seen_at', s.last_seen
    ) order by pp.matched_ads desc, s.ads_total desc), '[]'::jsonb) into result
  from (select * from per_page order by matched_ads desc limit 60) pp
  join public.pages p on p.id = pp.page_ref
  cross join lateral (
    select count(*) ads_total, count(*) filter (where a.is_active) active_ads,
      max(extract(day from now() - a.start_date))::int longest_days, max(a.last_seen_at) last_seen
    from public.ads a where a.page_ref = p.id
  ) s
  left join lateral (
    select po.page_name from public.page_observations po where po.page_ref = p.id order by po.observed_at desc limit 1
  ) pn on true;
  return result;
end $$;
revoke all on function public.rival_keyword_pages(text[]) from public, anon;
grant execute on function public.rival_keyword_pages(text[]) to authenticated;
notify pgrst, 'reload schema';
