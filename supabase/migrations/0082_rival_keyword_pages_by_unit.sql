-- The rival board asked rival_keyword_pages once per unit, all at the same moment: 16 units meant 16
-- reads of every ad's latest copy, and on 2026-11-26 the slowest passed the 8 s statement limit, so the
-- whole board answered 503 after each new round. This reads the copy once and matches every unit's
-- keywords against it. Per unit the answer is what rival_keyword_pages gives for the same keywords:
-- the same match (copy or the page's latest name), the same 60 pages, the same fields.
--   p_units: [{"unit": "<unit id>", "keywords": ["...", ...]}, ...]
--   returns: {"<unit id>": [page, ...]}; a unit with no match is left out.
-- rival_keyword_pages stays: a ส่องแอด search still asks it for one query.
--
-- Security definer, like the owned-ads reads: under the caller's own rights every row of the four
-- tables read here runs the policy's current_user_role() lookup (about 20,000 lookups a call, most of
-- the time measured on the pilot). Those policies ask only for a role row, any role, with no per-row
-- condition, so the same question asked once at the top admits exactly the same people.
create or replace function public.rival_keyword_pages_by_unit(p_units jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if public.current_user_role() is null then
    raise exception 'Role required' using errcode='42501';
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) > 200 then
    raise exception 'Invalid units' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_units) u
    where jsonb_typeof(u.value) <> 'object' or jsonb_typeof(u.value->'unit') <> 'string'
       or jsonb_typeof(u.value->'keywords') <> 'array' or jsonb_array_length(u.value->'keywords') > 30
  ) then
    raise exception 'Invalid units' using errcode='22023';
  end if;
  with kw as (
    -- rival_keyword_pages asks "copy ILIKE %keyword%" with the keyword's own % and _ escaped: the keyword
    -- anywhere in the copy, whatever the case. Lowering both sides once and looking for the keyword is
    -- that same match, without lowering the copy again for every keyword.
    select distinct u.value->>'unit' unit, lower(k) word
    from jsonb_array_elements(p_units) u cross join lateral jsonb_array_elements_text(u.value->'keywords') k
    where length(btrim(k)) between 2 and 60
  ), latest as (
    select distinct on (o.ad_ref) o.ad_ref, o.title, o.body_text, o.observed_at
    from public.ad_observations o order by o.ad_ref, o.observed_at desc
  ), names as (
    select distinct on (po.page_ref) po.page_ref, po.page_name
    from public.page_observations po order by po.page_ref, po.observed_at desc
  ), texts as materialized (
    -- Every ad's latest copy with its page's latest name, read once for all units.
    select a.page_ref, a.id ad_id, a.first_seen_at, l.observed_at,
      coalesce(nullif(l.title,''), left(l.body_text,140)) sample,
      lower(coalesce(l.title,'') || ' ' || coalesce(l.body_text,'') || ' ' || coalesce(n.page_name,'')) hay
    from latest l join public.ads a on a.id = l.ad_ref
    left join names n on n.page_ref = a.page_ref
  ), matched as (
    select u.unit, t.page_ref, t.ad_id, t.sample, t.observed_at, t.first_seen_at
    from (select distinct unit from kw) u cross join texts t
    where exists (select 1 from kw where kw.unit = u.unit and strpos(t.hay, kw.word) > 0)
  ), per_page as (
    select unit, page_ref, count(distinct ad_id) matched_ads, (array_agg(sample order by observed_at desc))[1] sample,
      count(distinct ad_id) filter (where first_seen_at > now() - interval '7 days') new_matched_7d
    from matched group by unit, page_ref
  ), top as (
    select * from (
      select per_page.*, row_number() over (partition by unit order by matched_ads desc, page_ref) place from per_page
    ) ranked where place <= 60
  ), page_facts as (
    -- A page several units match is counted once.
    select p.id page_ref, p.page_id, pn.page_name, s.ads_total, s.active_ads, s.longest_days, s.last_seen
    from (select distinct page_ref from top) found
    join public.pages p on p.id = found.page_ref
    cross join lateral (
      select count(*) ads_total, count(*) filter (where a.is_active) active_ads,
        max(extract(day from now() - a.start_date))::int longest_days, max(a.last_seen_at) last_seen
      from public.ads a where a.page_ref = p.id
    ) s
    left join lateral (
      select po.page_name from public.page_observations po where po.page_ref = p.id order by po.observed_at desc limit 1
    ) pn on true
  ), per_unit as (
    select t.unit, jsonb_agg(jsonb_build_object(
        'page_id', f.page_id, 'page_name', f.page_name, 'matched_ads', t.matched_ads, 'sample', t.sample, 'new_matched_7d', t.new_matched_7d,
        'ads_total', f.ads_total, 'active_ads', f.active_ads, 'longest_days', f.longest_days, 'last_seen_at', f.last_seen
      ) order by t.matched_ads desc, f.ads_total desc, f.page_id) pages
    from top t join page_facts f on f.page_ref = t.page_ref
    group by t.unit
  )
  select coalesce(jsonb_object_agg(unit, pages), '{}'::jsonb) into result from per_unit;
  return result;
end $$;
revoke all on function public.rival_keyword_pages_by_unit(jsonb) from public, anon;
grant execute on function public.rival_keyword_pages_by_unit(jsonb) to authenticated;
notify pgrst, 'reload schema';
