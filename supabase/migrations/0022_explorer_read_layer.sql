-- Ads Explorer read layer (V3). Read-only: no table, no column, no stored value.
--
-- Three changes:
--   1. dataset_ads_page gains the advanced filters, a sort allowlist, and the
--      snapshot fields the grid needs (first/last seen, ad age, media).
--   2. dataset_ads_facets gains a label column and a page facet, so the Page
--      filter can offer names while filtering by id.
--   3. evergreen_threshold_days() exposes one app_settings row to analysts.
--
-- Everything still reads the dataset's own collection run. There is no path in
-- here that falls back to the latest observation: a historical dataset must not
-- change shape because a newer run landed.

-- ---------------------------------------------------------------------------
-- The evergreen threshold
--
-- app_settings is admin-only under RLS (0016), and these read functions are
-- SECURITY INVOKER, so an analyst's session cannot read the row. This function
-- is the one exception: SECURITY DEFINER, returning a single non-sensitive
-- integer, so the rule stays configured in one place instead of being
-- hard-coded in the query or passed in from the browser.
create function public.evergreen_threshold_days()
returns int
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings
                    where key = 'evergreen_threshold_days'), 90)
$$;

revoke all on function public.evergreen_threshold_days() from public;
revoke all on function public.evergreen_threshold_days() from anon;
grant execute on function public.evergreen_threshold_days() to authenticated;

-- ---------------------------------------------------------------------------
-- Explorer page
drop function if exists public.dataset_ads_page(uuid, text, text, text, text, text, text, int, int);

create function public.dataset_ads_page(
  p_dataset_id uuid,
  p_active text default null,
  p_format text default null,
  p_cta text default null,
  p_platform text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 30,
  p_offset int default 0,
  -- Advanced filters. Every one of them is optional and null means "any".
  p_page_id text default null,
  p_started_from timestamptz default null,
  p_started_to timestamptz default null,
  p_first_seen_from timestamptz default null,
  p_first_seen_to timestamptz default null,
  p_last_seen_from timestamptz default null,
  p_last_seen_to timestamptz default null,
  p_age_min int default null,
  p_age_max int default null,
  p_evergreen boolean default null,
  p_reuse_min int default null,
  p_has_video boolean default null,
  p_has_image boolean default null,
  p_has_title boolean default null,
  p_has_destination boolean default null,
  -- Allowlisted key, never a column name. An unrecognised value sorts by the
  -- default rather than raising, because the route rejects it before this.
  p_sort text default 'started_desc'
)
returns table (
  ad_archive_id text, is_active boolean, display_format text,
  publisher_platform text[], cta_type text, cta_text text, title text,
  body_text text, page_id text, page_name text, page_categories text[],
  start_date timestamptz, collation_count int,
  first_seen_at timestamptz, last_seen_at timestamptz, ad_age_days int,
  media jsonb, total_count bigint
)
language sql stable as $$
  with snapshot as (
    select a.ad_archive_id, o.is_active, o.display_format, o.publisher_platform,
           o.cta_type, o.cta_text, o.title, o.body_text,
           p.page_id, po.page_name, po.page_categories,
           a.start_date, o.collation_count,
           a.first_seen_at, a.last_seen_at,
           (current_date - a.start_date::date)::int as ad_age_days,
           -- The media observed in THIS run. Never the newest observation.
           o.media, o.link_url
      from public.datasets d
      join public.dataset_ads da on da.dataset_id = d.id
      join public.ads a on a.id = da.ad_ref
      join public.ad_observations o
        on o.ad_ref = a.id and o.collection_run_id = d.collection_run_id
      join public.pages p on p.id = a.page_ref
      left join public.page_observations po
        on po.page_ref = p.id and po.collection_run_id = d.collection_run_id
     where d.id = p_dataset_id
  ), filtered as (
    select * from snapshot
     where (p_active is null
            or (p_active = 'active'   and is_active is true)
            or (p_active = 'inactive' and is_active is false)
            or (p_active = 'unknown'  and is_active is null))
       and (p_format   is null or display_format = p_format)
       and (p_cta      is null or cta_type = p_cta)
       and (p_platform is null or publisher_platform @> array[p_platform])
       and (p_category is null or page_categories  @> array[p_category])
       and (p_search   is null or body_text ilike '%' || p_search || '%'
            or title ilike '%' || p_search || '%')
       and (p_page_id  is null or page_id = p_page_id)
       -- Dates. start_date is when Meta says the ad started running;
       -- first_seen_at is when PT Glory first observed it. They are not
       -- interchangeable and each has its own filter.
       and (p_started_from    is null or start_date    >= p_started_from)
       and (p_started_to      is null or start_date    <= p_started_to)
       and (p_first_seen_from is null or first_seen_at >= p_first_seen_from)
       and (p_first_seen_to   is null or first_seen_at <= p_first_seen_to)
       and (p_last_seen_from  is null or last_seen_at  >= p_last_seen_from)
       and (p_last_seen_to    is null or last_seen_at  <= p_last_seen_to)
       and (p_age_min is null or ad_age_days >= p_age_min)
       and (p_age_max is null or ad_age_days <= p_age_max)
       -- Evergreen is running AND old. An ad whose state is unknown is not
       -- evergreen and is not "not evergreen" either, so p_evergreen = false
       -- only excludes the ones that positively qualify.
       and (p_evergreen is null
            or (p_evergreen is true
                and is_active is true
                and ad_age_days >= public.evergreen_threshold_days())
            or (p_evergreen is false
                and not (is_active is true
                         and ad_age_days >= public.evergreen_threshold_days())))
       and (p_reuse_min is null or coalesce(collation_count, 0) >= p_reuse_min)
       -- Presence mirrors lib/collector/coverage.ts isPresent: null and blank
       -- are absent, an array of empty objects is absent, false and 0 are
       -- present values. A missing field says the collector could not read it,
       -- never that the advertiser did something.
       and (p_has_title is null or p_has_title = (title is not null and btrim(title) <> ''))
       and (p_has_destination is null
            or p_has_destination = (link_url is not null and btrim(link_url) <> ''))
       and (p_has_video is null or p_has_video = exists (
              select 1 from jsonb_array_elements(coalesce(media->'videos', '[]'::jsonb)) e
               where e <> 'null'::jsonb and e <> '{}'::jsonb))
       and (p_has_image is null or p_has_image = exists (
              select 1 from jsonb_array_elements(coalesce(media->'images', '[]'::jsonb)) e
               where e <> 'null'::jsonb and e <> '{}'::jsonb))
  )
  select f.ad_archive_id, f.is_active, f.display_format, f.publisher_platform,
         f.cta_type, f.cta_text, f.title, f.body_text, f.page_id, f.page_name,
         f.page_categories, f.start_date, f.collation_count,
         f.first_seen_at, f.last_seen_at, f.ad_age_days, f.media,
         (select count(*) from filtered) as total_count
    from filtered f
   order by
     case when p_sort = 'started_asc'      then f.start_date end asc  nulls last,
     case when p_sort = 'discovered_desc'  then f.first_seen_at end desc nulls last,
     case when p_sort = 'observed_desc'    then f.last_seen_at end desc nulls last,
     case when p_sort = 'longest_running'  then f.ad_age_days end desc nulls last,
     case when p_sort = 'most_reused'      then coalesce(f.collation_count, 0) end desc,
     case when p_sort = 'page_name'        then f.page_name end asc nulls last,
     -- Default, and the tiebreak for every other key, so a page boundary never
     -- lands mid-way through an ambiguous ordering.
     f.start_date desc, f.ad_archive_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

-- ---------------------------------------------------------------------------
-- Facets, now with a display label and a page facet.
drop function if exists public.dataset_ads_facets(uuid);

create function public.dataset_ads_facets(p_dataset_id uuid)
returns table (facet text, value text, label text, n bigint)
language sql stable as $$
  with snapshot as (
    select o.is_active, o.display_format, o.cta_type, o.publisher_platform,
           po.page_categories, p.page_id, po.page_name
      from public.datasets d
      join public.dataset_ads da on da.dataset_id = d.id
      join public.ads a on a.id = da.ad_ref
      join public.ad_observations o
        on o.ad_ref = a.id and o.collection_run_id = d.collection_run_id
      join public.pages p on p.id = a.page_ref
      left join public.page_observations po
        on po.page_ref = a.page_ref and po.collection_run_id = d.collection_run_id
     where d.id = p_dataset_id
  )
  select 'active',
         case when is_active is true then 'active'
              when is_active is false then 'inactive' else 'unknown' end,
         case when is_active is true then 'Active'
              when is_active is false then 'Inactive' else 'ไม่ทราบ' end,
         count(*)
    from snapshot group by 2, 3
  union all
  select 'display_format', coalesce(display_format, '—'), coalesce(display_format, '—'), count(*)
    from snapshot group by 2, 3
  union all
  select 'cta_type', coalesce(cta_type, '—'), coalesce(cta_type, '—'), count(*)
    from snapshot group by 2, 3
  union all
  select 'publisher_platform', platform, platform, count(*)
    from snapshot, unnest(publisher_platform) as platform group by 2, 3
  union all
  select 'page_category', category, category, count(*)
    from snapshot, unnest(page_categories) as category group by 2, 3
  union all
  -- Filtered by id, offered by name: two pages may share a name, and a name is
  -- not an identity in this product.
  select 'page', page_id, coalesce(page_name, page_id), count(*)
    from snapshot group by 2, 3
$$;

-- ---------------------------------------------------------------------------
-- Permissions, re-applied because DROP took the old ACLs with it (0019).
do $$
declare
  fn text;
  signatures text[] := array[
    'public.dataset_ads_page(uuid, text, text, text, text, text, text, int, int, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, int, int, boolean, int, boolean, boolean, boolean, boolean, text)',
    'public.dataset_ads_facets(uuid)',
    'public.evergreen_threshold_days()'
  ];
begin
  foreach fn in array signatures loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
    execute format('alter function %s set search_path = public, pg_temp', fn);

    if has_function_privilege('anon', fn, 'execute') then
      raise exception '% must not be executable by anon', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception '% must stay executable by authenticated', fn;
    end if;
  end loop;

  -- The two page/facet readers must stay SECURITY INVOKER so RLS decides what
  -- the caller sees. Only the settings reader is DEFINER, and deliberately so.
  if (select prosecdef from pg_proc where oid = signatures[1]::regprocedure)
     or (select prosecdef from pg_proc where oid = signatures[2]::regprocedure) then
    raise exception 'the explorer read functions must stay SECURITY INVOKER';
  end if;
end $$;
