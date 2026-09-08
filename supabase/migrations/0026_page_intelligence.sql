-- Page Intelligence read layer (P2.1). Read-only: no table, no column, no
-- stored value, no new fact. Everything below aggregates observations that are
-- already in the database.
--
-- The whole feature rests on one idea: a Page result always has an explicit
-- SCOPE, and every number in it comes from that scope alone.
--
--   dataset   the ads in one dataset, read through that dataset's own
--             collection run — Snapshot Truth, unchanged
--   category  the ads in every dataset of one category
--   all       every ad in every dataset
--
-- Inside a dataset there is exactly one run, so "the latest observation in
-- scope" IS that dataset's snapshot. The wider scopes reuse the same rule
-- rather than inventing a second one, which is what keeps a page's numbers
-- meaning the same thing however the analyst arrived at them.
--
-- A Page is not a Brand. Nothing here groups pages, matches names, or presents
-- a page aggregate as a brand aggregate.

-- ---------------------------------------------------------------------------
-- The scope: one ad, one observation, one run.
--
-- SECURITY INVOKER like every other read function, so RLS decides which rows
-- the caller can see. Soft-deleted datasets are excluded here rather than in
-- five callers.
create function public.page_scope_observations(
  p_scope text,
  p_scope_id uuid default null
)
returns table (
  ad_ref uuid,
  observation_id bigint,
  collection_run_id uuid,
  collected_at timestamptz
)
language sql stable as $$
  with runs as (
    select d.collection_run_id, cr.collected_at
      from public.datasets d
      join public.collection_runs cr on cr.id = d.collection_run_id
     where d.deleted_at is null
       and (p_scope = 'all'
            or (p_scope = 'dataset'  and d.id = p_scope_id)
            or (p_scope = 'category' and d.category_id = p_scope_id))
  ), members as (
    select distinct da.ad_ref
      from public.dataset_ads da
      join public.datasets d on d.id = da.dataset_id
      join runs r on r.collection_run_id = d.collection_run_id
  )
  -- The most recent observation of each ad WITHIN the scope. One run in scope
  -- means one observation, which is why dataset scope stays pinned.
  select distinct on (o.ad_ref)
         o.ad_ref, o.id, o.collection_run_id, r.collected_at
    from public.ad_observations o
    join runs r on r.collection_run_id = o.collection_run_id
    join members m on m.ad_ref = o.ad_ref
   order by o.ad_ref, o.observed_at desc, o.id desc
$$;

-- ---------------------------------------------------------------------------
-- Page list.
--
-- p_active selects PAGES THAT HAVE at least one ad in that state; it does not
-- change any count in the row. Filtering the counted ads instead would produce
-- a page whose "observed ads" was smaller than the page's actual ads in scope,
-- which reads as a fact about the page rather than about the filter.
create function public.page_list(
  p_scope text,
  p_scope_id uuid default null,
  p_search text default null,
  p_active text default null,
  p_category text default null,
  p_recent_days int default 30,
  p_sort text default 'observed_ads',
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  page_id text,
  page_name text,
  page_categories text[],
  page_like_count bigint,
  observed_ads bigint,
  active_ads bigint,
  inactive_ads bigint,
  unknown_ads bigint,
  recently_found bigint,
  evergreen_ads bigint,
  reused_ads bigint,
  max_collation int,
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  total_count bigint
)
language sql stable as $$
  with scope as (
    select * from public.page_scope_observations(p_scope, p_scope_id)
  ), ads_in_scope as (
    select a.page_ref, a.ad_archive_id, a.start_date, a.first_seen_at,
           o.is_active, o.collation_count,
           (current_date - a.start_date::date)::int as ad_age_days,
           s.collected_at
      from scope s
      join public.ad_observations o on o.id = s.observation_id
      join public.ads a on a.id = s.ad_ref
  ), latest_page as (
    -- The page's own name, categories and like count as most recently observed
    -- in this scope. A page seen in three runs has three names on record; the
    -- current one is what a research surface should lead with, and the history
    -- stays available in page_like_history below.
    select distinct on (po.page_ref)
           po.page_ref, po.page_name, po.page_categories, po.page_like_count
      from public.page_observations po
      join public.datasets d on d.collection_run_id = po.collection_run_id
     where d.deleted_at is null
       and (p_scope = 'all'
            or (p_scope = 'dataset'  and d.id = p_scope_id)
            or (p_scope = 'category' and d.category_id = p_scope_id))
     order by po.page_ref, po.observed_at desc, po.id desc
  ), page_seen as (
    -- When this page was first and last OBSERVED, across every run in scope
    -- that saw it. Computed from the runs, not from the observations the scope
    -- selected: the scope keeps one observation per ad, so reading first-seen
    -- off it would report the newest run as the moment the page appeared.
    select po.page_ref,
           min(cr.collected_at) as first_observed_at,
           max(cr.collected_at) as last_observed_at,
           count(distinct po.collection_run_id) as runs_seen
      from public.page_observations po
      join public.datasets d on d.collection_run_id = po.collection_run_id
      join public.collection_runs cr on cr.id = po.collection_run_id
     where d.deleted_at is null
       and (p_scope = 'all'
            or (p_scope = 'dataset'  and d.id = p_scope_id)
            or (p_scope = 'category' and d.category_id = p_scope_id))
     group by po.page_ref
  ), rolled as (
    select p.page_id,
           lp.page_name,
           lp.page_categories,
           lp.page_like_count,
           count(*)                                                as observed_ads,
           count(*) filter (where x.is_active is true)             as active_ads,
           count(*) filter (where x.is_active is false)            as inactive_ads,
           count(*) filter (where x.is_active is null)             as unknown_ads,
           -- Recently found is about when WE first saw the ad. Started recently
           -- is about Meta's start date. Two different facts, never merged.
           count(*) filter (
             where x.first_seen_at >= now() - make_interval(days => greatest(p_recent_days, 0)))
                                                                   as recently_found,
           count(*) filter (
             where x.is_active is true
               and x.ad_age_days >= public.evergreen_threshold_days())
                                                                   as evergreen_ads,
           count(*) filter (where coalesce(x.collation_count, 0) > 1) as reused_ads,
           max(x.collation_count)                                  as max_collation,
           max(ps.first_observed_at)                               as first_observed_at,
           max(ps.last_observed_at)                                as last_observed_at
      from ads_in_scope x
      join public.pages p on p.id = x.page_ref
      left join latest_page lp on lp.page_ref = x.page_ref
      left join page_seen ps on ps.page_ref = x.page_ref
     group by p.page_id, lp.page_name, lp.page_categories, lp.page_like_count
  ), filtered as (
    select * from rolled
     where (p_search is null
            or page_name ilike '%' || p_search || '%'
            or page_id = p_search)
       and (p_category is null or page_categories @> array[p_category])
       -- Presence of a state, not a re-count. Unknown is its own answer here,
       -- never folded into inactive.
       and (p_active is null
            or (p_active = 'active'   and active_ads   > 0)
            or (p_active = 'inactive' and inactive_ads > 0)
            or (p_active = 'unknown'  and unknown_ads  > 0))
  )
  select f.page_id, f.page_name, f.page_categories, f.page_like_count,
         f.observed_ads, f.active_ads, f.inactive_ads, f.unknown_ads,
         f.recently_found, f.evergreen_ads, f.reused_ads, f.max_collation,
         f.first_observed_at, f.last_observed_at,
         (select count(*) from filtered) as total_count
    from filtered f
   order by
     case when p_sort = 'recently_found'  then f.recently_found end desc nulls last,
     case when p_sort = 'evergreen'       then f.evergreen_ads  end desc nulls last,
     case when p_sort = 'reuse'           then f.max_collation  end desc nulls last,
     case when p_sort = 'first_observed'  then f.first_observed_at end desc nulls last,
     case when p_sort = 'last_observed'   then f.last_observed_at  end desc nulls last,
     case when p_sort = 'page_name'       then f.page_name      end asc  nulls last,
     -- Default, and the tiebreak for every other key, so a page boundary never
     -- lands in the middle of an ambiguous ordering.
     f.observed_ads desc, f.page_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

-- ---------------------------------------------------------------------------
-- One page, in scope. Same aggregates as the list plus identity, so the detail
-- page cannot disagree with the row that led to it.
create function public.page_detail(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null,
  p_recent_days int default 30
)
returns table (
  page_id text,
  page_profile_numeric_id text,
  page_profile_uri text,
  page_name text,
  page_categories text[],
  page_like_count bigint,
  observed_ads bigint,
  active_ads bigint,
  inactive_ads bigint,
  unknown_ads bigint,
  recently_found bigint,
  started_recently bigint,
  evergreen_ads bigint,
  reused_ads bigint,
  max_collation int,
  oldest_start_date timestamptz,
  newest_start_date timestamptz,
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  runs_in_scope bigint
)
language sql stable as $$
  with scope as (
    select * from public.page_scope_observations(p_scope, p_scope_id)
  ), ads_in_scope as (
    select a.ad_archive_id, a.start_date, a.first_seen_at,
           o.is_active, o.collation_count,
           (current_date - a.start_date::date)::int as ad_age_days,
           s.collected_at, s.collection_run_id
      from scope s
      join public.ad_observations o on o.id = s.observation_id
      join public.ads a on a.id = s.ad_ref
      join public.pages p on p.id = a.page_ref
     where p.page_id = p_page_id
  ), identity as (
    select p.page_id, p.page_profile_numeric_id, p.page_profile_uri
      from public.pages p where p.page_id = p_page_id
  ), page_seen as (
    -- First seen, last seen, and how many runs in scope saw this page at all.
    -- All three come from the collection runs, never from the ads: the scope
    -- keeps one observation per ad, so reading them off it would report the
    -- newest run as the moment the page appeared.
    select min(cr.collected_at) as first_observed_at,
           max(cr.collected_at) as last_observed_at,
           count(distinct po.collection_run_id) as runs_seen
      from public.page_observations po
      join public.pages p on p.id = po.page_ref
      join public.datasets d on d.collection_run_id = po.collection_run_id
      join public.collection_runs cr on cr.id = po.collection_run_id
     where p.page_id = p_page_id
       and d.deleted_at is null
       and (p_scope = 'all'
            or (p_scope = 'dataset'  and d.id = p_scope_id)
            or (p_scope = 'category' and d.category_id = p_scope_id))
  ), latest_page as (
    select po.page_name, po.page_categories, po.page_like_count
      from public.page_observations po
      join public.pages p on p.id = po.page_ref
      join public.datasets d on d.collection_run_id = po.collection_run_id
     where p.page_id = p_page_id
       and d.deleted_at is null
       and (p_scope = 'all'
            or (p_scope = 'dataset'  and d.id = p_scope_id)
            or (p_scope = 'category' and d.category_id = p_scope_id))
     order by po.observed_at desc, po.id desc
     limit 1
  )
  select i.page_id, i.page_profile_numeric_id, i.page_profile_uri,
         lp.page_name, lp.page_categories, lp.page_like_count,
         count(x.*),
         count(x.*) filter (where x.is_active is true),
         count(x.*) filter (where x.is_active is false),
         count(x.*) filter (where x.is_active is null),
         count(x.*) filter (
           where x.first_seen_at >= now() - make_interval(days => greatest(p_recent_days, 0))),
         -- Started recently reads Meta's start date, and is deliberately a
         -- separate number from recently found above.
         count(x.*) filter (
           where x.start_date >= now() - make_interval(days => greatest(p_recent_days, 0))),
         count(x.*) filter (
           where x.is_active is true
             and x.ad_age_days >= public.evergreen_threshold_days()),
         count(x.*) filter (where coalesce(x.collation_count, 0) > 1),
         max(x.collation_count),
         min(x.start_date), max(x.start_date),
         max(ps.first_observed_at), max(ps.last_observed_at),
         max(ps.runs_seen)
    from identity i
    left join ads_in_scope x on true
    left join latest_page lp on true
    left join page_seen ps on true
   group by i.page_id, i.page_profile_numeric_id, i.page_profile_uri,
            lp.page_name, lp.page_categories, lp.page_like_count
$$;

-- ---------------------------------------------------------------------------
-- Creative mix.
--
-- Every row carries its own denominator, because the four dimensions do not
-- share one. display_format is exclusive and covers every ad. cta_type is only
-- as readable as the collector made it. publisher_platform and page_categories
-- are multi-value, so their shares legitimately exceed 100% and must never be
-- drawn as slices of a pie.
create function public.page_creative_mix(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null
)
returns table (
  dimension text,
  value text,
  n bigint,
  covered bigint,
  observed bigint,
  exclusive boolean
)
language sql stable as $$
  with scope as (
    select * from public.page_scope_observations(p_scope, p_scope_id)
  ), ads_in_scope as (
    select o.display_format, o.cta_type, o.publisher_platform, po.page_categories
      from scope s
      join public.ad_observations o on o.id = s.observation_id
      join public.ads a on a.id = s.ad_ref
      join public.pages p on p.id = a.page_ref
      left join public.page_observations po
        on po.page_ref = a.page_ref and po.collection_run_id = s.collection_run_id
     where p.page_id = p_page_id
  ), totals as (
    select count(*) as observed,
           count(*) filter (where display_format is not null) as format_covered,
           count(*) filter (where cta_type is not null)       as cta_covered,
           count(*) filter (where publisher_platform is not null
                              and cardinality(publisher_platform) > 0) as platform_covered,
           count(*) filter (where page_categories is not null
                              and cardinality(page_categories) > 0)    as category_covered
      from ads_in_scope
  )
  select 'display_format', coalesce(x.display_format, '—'), count(*),
         t.format_covered, t.observed, true
    from ads_in_scope x, totals t
   group by 2, t.format_covered, t.observed
  union all
  select 'cta_type', x.cta_type, count(*), t.cta_covered, t.observed, true
    from ads_in_scope x, totals t
   where x.cta_type is not null
   group by 2, t.cta_covered, t.observed
  union all
  select 'publisher_platform', platform, count(*), t.platform_covered, t.observed, false
    from ads_in_scope x, totals t, unnest(x.publisher_platform) as platform
   group by 2, t.platform_covered, t.observed
  union all
  select 'page_category', category, count(*), t.category_covered, t.observed, false
    from ads_in_scope x, totals t, unnest(x.page_categories) as category
   group by 2, t.category_covered, t.observed
$$;

-- ---------------------------------------------------------------------------
-- Activity.
--
-- Two series, each labelled by what it actually counts. They are never summed
-- and never drawn as one line: "we first saw it" and "Meta says it started" are
-- different events about the same ad, often months apart.
create function public.page_activity(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null,
  p_bucket text default 'week'
)
returns table (
  bucket_start timestamptz,
  first_seen_ads bigint,
  started_ads bigint
)
language sql stable as $$
  with scope as (
    select * from public.page_scope_observations(p_scope, p_scope_id)
  ), ads_in_scope as (
    select a.start_date, a.first_seen_at
      from scope s
      join public.ads a on a.id = s.ad_ref
      join public.pages p on p.id = a.page_ref
     where p.page_id = p_page_id
  ), unit as (
    select case when p_bucket = 'day' then 'day' else 'week' end as u
  ), points as (
    select date_trunc((select u from unit), first_seen_at) as bucket_start,
           1 as first_seen, 0 as started
      from ads_in_scope
    union all
    select date_trunc((select u from unit), start_date), 0, 1
      from ads_in_scope
  )
  select bucket_start, sum(first_seen)::bigint, sum(started)::bigint
    from points
   group by bucket_start
   order by bucket_start
$$;

-- ---------------------------------------------------------------------------
-- Page likes over time.
--
-- Observation-level page data, one row per run that saw the page. Never summed
-- across pages, never presented as a performance figure for an ad.
create function public.page_like_history(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null
)
returns table (
  observed_at timestamptz,
  collection_run_id uuid,
  page_like_count bigint,
  page_name text
)
language sql stable as $$
  select po.observed_at, po.collection_run_id, po.page_like_count, po.page_name
    from public.page_observations po
    join public.pages p on p.id = po.page_ref
    join public.datasets d on d.collection_run_id = po.collection_run_id
   where p.page_id = p_page_id
     and d.deleted_at is null
     and (p_scope = 'all'
          or (p_scope = 'dataset'  and d.id = p_scope_id)
          or (p_scope = 'category' and d.category_id = p_scope_id))
   order by po.observed_at desc, po.id desc
$$;

-- ---------------------------------------------------------------------------
-- The evidence behind every number above.
--
-- Same row shape the Explorer grid already renders, so the card, the thumbnail
-- and the drawer are the frozen ones rather than a second implementation.
create function public.page_ads(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null,
  -- An allowlisted signal name, never an expression. Null means every ad.
  p_signal text default null,
  p_recent_days int default 30,
  p_format text default null,
  p_cta text default null,
  p_platform text default null,
  p_sort text default 'started_desc',
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  ad_archive_id text, is_active boolean, display_format text,
  publisher_platform text[], cta_type text, cta_text text, title text,
  body_text text, page_id text, page_name text, page_categories text[],
  start_date timestamptz, collation_count int,
  first_seen_at timestamptz, last_seen_at timestamptz, ad_age_days int,
  media jsonb, archive_path text, archive_status text, total_count bigint
)
language sql stable as $$
  with scope as (
    select * from public.page_scope_observations(p_scope, p_scope_id)
  ), rows_in_scope as (
    select a.ad_archive_id, o.is_active, o.display_format, o.publisher_platform,
           o.cta_type, o.cta_text, o.title, o.body_text,
           p.page_id, po.page_name, po.page_categories,
           a.start_date, o.collation_count,
           a.first_seen_at, a.last_seen_at,
           (current_date - a.start_date::date)::int as ad_age_days,
           o.media,
           m.storage_path as archive_path, m.archive_status
      from scope s
      join public.ad_observations o on o.id = s.observation_id
      join public.ads a on a.id = s.ad_ref
      join public.pages p on p.id = a.page_ref
      left join public.page_observations po
        on po.page_ref = a.page_ref and po.collection_run_id = s.collection_run_id
      left join public.media_assets m on m.ad_observation_id = o.id
     where p.page_id = p_page_id
  ), filtered as (
    select * from rows_in_scope
     where (p_format   is null or display_format = p_format)
       and (p_cta      is null or cta_type = p_cta)
       and (p_platform is null or publisher_platform @> array[p_platform])
       and (p_signal is null
            or (p_signal = 'recent'
                and first_seen_at >= now() - make_interval(days => greatest(p_recent_days, 0)))
            or (p_signal = 'started_recently'
                and start_date >= now() - make_interval(days => greatest(p_recent_days, 0)))
            or (p_signal = 'evergreen'
                and is_active is true
                and ad_age_days >= public.evergreen_threshold_days())
            or (p_signal = 'reused' and coalesce(collation_count, 0) > 1)
            or (p_signal = 'active'   and is_active is true)
            or (p_signal = 'inactive' and is_active is false)
            or (p_signal = 'unknown'  and is_active is null))
  )
  select f.ad_archive_id, f.is_active, f.display_format, f.publisher_platform,
         f.cta_type, f.cta_text, f.title, f.body_text, f.page_id, f.page_name,
         f.page_categories, f.start_date, f.collation_count,
         f.first_seen_at, f.last_seen_at, f.ad_age_days, f.media,
         f.archive_path, f.archive_status,
         (select count(*) from filtered) as total_count
    from filtered f
   order by
     case when p_sort = 'started_asc'     then f.start_date end asc nulls last,
     case when p_sort = 'discovered_desc' then f.first_seen_at end desc nulls last,
     case when p_sort = 'observed_desc'   then f.last_seen_at end desc nulls last,
     case when p_sort = 'longest_running' then f.ad_age_days end desc nulls last,
     case when p_sort = 'most_reused'     then coalesce(f.collation_count, 0) end desc,
     f.start_date desc, f.ad_archive_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

-- ---------------------------------------------------------------------------
-- Permissions. Same contract as every other read function: authenticated only,
-- never anon, never PUBLIC, search_path pinned, SECURITY INVOKER so RLS is the
-- boundary. Asserted here rather than trusted.
do $$
declare
  fn text;
  signatures text[] := array[
    'public.page_scope_observations(text, uuid)',
    'public.page_list(text, uuid, text, text, text, int, text, int, int)',
    'public.page_detail(text, uuid, text, int)',
    'public.page_creative_mix(text, uuid, text)',
    'public.page_activity(text, uuid, text, text)',
    'public.page_like_history(text, uuid, text)',
    'public.page_ads(text, uuid, text, text, int, text, text, text, text, int, int)'
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
    if (select prosecdef from pg_proc where oid = fn::regprocedure) then
      raise exception '% must stay SECURITY INVOKER so RLS decides what it returns', fn;
    end if;
  end loop;
end $$;
