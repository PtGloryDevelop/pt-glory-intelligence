-- Pages the team confirmed as a unit's rivals, read by id: a confirmed page stays on the board even when
-- none of the unit's keywords appears in its ads or name (it was confirmed from a search in ส่องแอด).
-- Same output shape as rival_keyword_pages; matched_ads and new_matched_7d count all of the page's ads,
-- since every ad of a confirmed page is a rival ad.
create or replace function public.rival_pages_by_id(p_page_ids text[])
returns jsonb language plpgsql stable set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if p_page_ids is null or cardinality(p_page_ids) > 200 then
    raise exception 'Invalid pages' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'page_id', p.page_id, 'page_name', pn.page_name, 'matched_ads', s.ads_total, 'sample', smp.sample, 'new_matched_7d', s.new_7d,
      'ads_total', s.ads_total, 'active_ads', s.active_ads, 'longest_days', s.longest_days, 'last_seen_at', s.last_seen
    ) order by s.ads_total desc, p.page_id), '[]'::jsonb) into result
  from public.pages p
  cross join lateral (
    select count(*) ads_total, count(*) filter (where a.is_active) active_ads,
      count(*) filter (where a.first_seen_at > now() - interval '7 days') new_7d,
      max(extract(day from now() - a.start_date))::int longest_days, max(a.last_seen_at) last_seen
    from public.ads a where a.page_ref = p.id
  ) s
  left join lateral (
    select po.page_name from public.page_observations po where po.page_ref = p.id order by po.observed_at desc limit 1
  ) pn on true
  left join lateral (
    select coalesce(nullif(o.title,''), left(o.body_text,140)) sample
    from public.ads a join lateral (
      select o.title, o.body_text, o.observed_at from public.ad_observations o where o.ad_ref = a.id order by o.observed_at desc limit 1
    ) o on true
    where a.page_ref = p.id order by a.last_seen_at desc nulls last limit 1
  ) smp on true
  where p.page_id = any(p_page_ids);
  return result;
end $$;
revoke all on function public.rival_pages_by_id(text[]) from public, anon;
grant execute on function public.rival_pages_by_id(text[]) to authenticated;
notify pgrst, 'reload schema';
