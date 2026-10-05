-- UI v2 competitors: which competitor pages collide with which of our units.
--
-- unit_id/unit_name come from Ads Management's UNIT (via owned_library_daily); they are stored as text
-- because that table lives in another database. A Page is not a Brand: relations are per page.
-- Everything here is a team decision or a team-entered search term; nothing is inferred and stored.

create table public.unit_keywords (
  id uuid primary key default gen_random_uuid(),
  unit_id text not null check (unit_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  unit_name text not null check (length(unit_name) between 1 and 120),
  keyword text not null check (keyword = btrim(keyword) and length(keyword) between 2 and 60),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index unit_keywords_unique on public.unit_keywords (unit_id, lower(keyword));
comment on table public.unit_keywords is 'Team-entered search terms per unit; used to suggest competitor pages.';

create table public.rival_page_units (
  page_id text not null references public.pages(page_id) on delete cascade,
  unit_id text not null check (unit_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  unit_name text not null check (length(unit_name) between 1 and 120),
  relation text not null check (relation in ('direct', 'substitute', 'unrelated')),
  decided_by uuid default auth.uid() references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  primary key (page_id, unit_id)
);
comment on table public.rival_page_units is 'Team-confirmed relation of a competitor page to one of our units. Suggestions are never stored here.';

-- Company tracking list (ADR 0002): shared, not per user. Recording only; no scheduler reads it yet.
create table public.rival_tracked_pages (
  page_id text primary key references public.pages(page_id) on delete cascade,
  tracked_by uuid default auth.uid() references auth.users(id) on delete set null,
  tracked_at timestamptz not null default now()
);
comment on table public.rival_tracked_pages is 'Company-wide competitor tracking list. Shared across the team.';

alter table public.unit_keywords enable row level security;
alter table public.rival_page_units enable row level security;
alter table public.rival_tracked_pages enable row level security;

create policy unit_keywords_read on public.unit_keywords for select to authenticated using (public.current_user_role() is not null);
create policy unit_keywords_write on public.unit_keywords for insert to authenticated with check (public.current_user_role() in ('analyst','admin'));
create policy unit_keywords_delete on public.unit_keywords for delete to authenticated using (public.current_user_role() in ('analyst','admin'));

create policy rival_page_units_read on public.rival_page_units for select to authenticated using (public.current_user_role() is not null);
create policy rival_page_units_insert on public.rival_page_units for insert to authenticated with check (public.current_user_role() in ('analyst','admin'));
create policy rival_page_units_update on public.rival_page_units for update to authenticated
  using (public.current_user_role() in ('analyst','admin')) with check (public.current_user_role() in ('analyst','admin'));
create policy rival_page_units_delete on public.rival_page_units for delete to authenticated using (public.current_user_role() in ('analyst','admin'));

create policy rival_tracked_pages_read on public.rival_tracked_pages for select to authenticated using (public.current_user_role() is not null);
create policy rival_tracked_pages_insert on public.rival_tracked_pages for insert to authenticated with check (public.current_user_role() in ('analyst','admin'));
create policy rival_tracked_pages_delete on public.rival_tracked_pages for delete to authenticated using (public.current_user_role() in ('analyst','admin'));

grant select, insert, delete on table public.unit_keywords to authenticated;
grant select, insert, update, delete on table public.rival_page_units to authenticated;
grant select, insert, delete on table public.rival_tracked_pages to authenticated;

-- Pages whose latest observed ad copy matches any of the given terms. Invoker rights: the caller's RLS
-- on ads/pages/observations decides what is visible. Counts are observations we collected, not the market.
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
    select a.page_ref, a.id ad_id, coalesce(nullif(l.title,''), left(l.body_text,140)) sample, l.observed_at
    from latest l join public.ads a on a.id = l.ad_ref
    where exists (select 1 from kw where coalesce(l.title,'') || ' ' || coalesce(l.body_text,'') ilike kw.pat escape '\')
  ), per_page as (
    select page_ref, count(distinct ad_id) matched_ads, (array_agg(sample order by observed_at desc))[1] sample
    from matched group by page_ref
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'page_id', p.page_id, 'page_name', pn.page_name, 'matched_ads', pp.matched_ads, 'sample', pp.sample,
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
