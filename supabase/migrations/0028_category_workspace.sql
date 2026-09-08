-- Category workspace read layer (P2.3). Read-only: no table, no column, no
-- stored value, no aggregate cache.
--
-- A PT GLORY CATEGORY IS NOT A META PAGE CATEGORY.
--
--   categories.id          our internal research grouping. Datasets belong to
--                          it, and this file aggregates over it.
--   page_observations
--     .page_categories     what Meta says a page is ("Medical Center"). Free
--                          metadata, multi-value, and never a research scope.
--
-- Both are called "category" in English and both appear on this screen, so
-- every function below that touches Meta's version names it `page_category`,
-- never bare `category`. The parameter for the internal one is p_category_id.
--
-- TWO TRUTH LAYERS, one shared primitive each:
--
--   current view   public.page_scope_observations('category', id) — the latest
--                  observation of each distinct ad in the category. Feeds the
--                  overview, the page ranking, the mixes and the signals, so
--                  there is exactly one definition of "latest" on the screen.
--
--   historical     public.page_scope_ads + the runs themselves, exactly as P2.2
--                  established. Never the reduction above.
--
-- A category spans several collection runs, so none of this is a snapshot and
-- the UI says so. Nothing here is a market share: the denominator is the ads
-- PT Glory happened to observe, which is a fact about our collection.

-- ---------------------------------------------------------------------------
-- The category list.
--
-- No averaged quality score. A category's datasets can be individually fine and
-- collectively incomparable, and one number would hide exactly that.
create function public.category_list()
returns table (
  category_id uuid,
  category_name text,
  dataset_count bigint,
  observed_ads bigint,
  observed_pages bigint,
  first_collected_at timestamptz,
  last_collected_at timestamptz
)
language sql stable as $$
  with sets as (
    select d.category_id, d.id as dataset_id, d.collection_run_id, cr.collected_at
      from public.datasets d
      join public.collection_runs cr on cr.id = d.collection_run_id
     where d.deleted_at is null
  ), members as (
    -- Distinct ads per category: an ad in four of its datasets is one ad.
    select s.category_id, da.ad_ref
      from sets s
      join public.dataset_ads da on da.dataset_id = s.dataset_id
     group by s.category_id, da.ad_ref
  )
  select c.id, c.name,
         (select count(distinct s.dataset_id) from sets s where s.category_id = c.id),
         (select count(*) from members m where m.category_id = c.id),
         (select count(distinct a.page_ref)
            from members m join public.ads a on a.id = m.ad_ref
           where m.category_id = c.id),
         (select min(s.collected_at) from sets s where s.category_id = c.id),
         (select max(s.collected_at) from sets s where s.category_id = c.id)
    from public.categories c
   where c.deleted_at is null
   order by c.name
$$;

-- ---------------------------------------------------------------------------
-- One category's current observed view.
--
-- Every figure counts DISTINCT ADS. The same ad collected in three datasets of
-- this category is one ad here, and appears once in each signal.
create function public.category_detail(
  p_category_id uuid,
  p_recent_days int default 30
)
returns table (
  category_id uuid,
  category_name text,
  dataset_count bigint,
  run_count bigint,
  observed_ads bigint,
  observed_pages bigint,
  active_ads bigint,
  inactive_ads bigint,
  unknown_ads bigint,
  recently_found bigint,
  started_recently bigint,
  evergreen_ads bigint,
  reused_ads bigint,
  evergreen_threshold_days int,
  first_collected_at timestamptz,
  last_collected_at timestamptz
)
language sql stable as $$
  with scope as (
    select * from public.page_scope_observations('category', p_category_id)
  ), ads_in_scope as (
    select a.page_ref, o.is_active, o.collation_count,
           a.start_date, a.first_seen_at,
           (current_date - a.start_date::date)::int as ad_age_days
      from scope s
      join public.ad_observations o on o.id = s.observation_id
      join public.ads a on a.id = s.ad_ref
  ), sets as (
    select d.id as dataset_id, d.collection_run_id, cr.collected_at
      from public.datasets d
      join public.collection_runs cr on cr.id = d.collection_run_id
     where d.deleted_at is null and d.category_id = p_category_id
  )
  select c.id, c.name,
         (select count(distinct dataset_id) from sets),
         (select count(distinct collection_run_id) from sets),
         count(x.*),
         count(distinct x.page_ref),
         count(x.*) filter (where x.is_active is true),
         count(x.*) filter (where x.is_active is false),
         -- Unknown is its own answer, here as everywhere else.
         count(x.*) filter (where x.is_active is null),
         count(x.*) filter (
           where x.first_seen_at >= now() - make_interval(days => greatest(p_recent_days, 0))),
         -- Meta's start date. A different fact from the line above it.
         count(x.*) filter (
           where x.start_date >= now() - make_interval(days => greatest(p_recent_days, 0))),
         count(x.*) filter (
           where x.is_active is true
             and x.ad_age_days >= public.evergreen_threshold_days()),
         count(x.*) filter (where coalesce(x.collation_count, 0) > 1),
         public.evergreen_threshold_days(),
         (select min(collected_at) from sets),
         (select max(collected_at) from sets)
    from public.categories c
    left join ads_in_scope x on true
   where c.id = p_category_id and c.deleted_at is null
   group by c.id, c.name
$$;

-- ---------------------------------------------------------------------------
-- Which datasets the numbers came from.
--
-- Query and country travel with each row so the reader can judge whether the
-- datasets are comparable at all — the same reason P2.2 carries run identity.
create function public.category_datasets(p_category_id uuid)
returns table (
  dataset_id uuid,
  dataset_name text,
  collection_run_id uuid,
  collected_at timestamptz,
  run_status text,
  scope_query text,
  scope_country text,
  ads_in_dataset bigint,
  pages_in_dataset bigint
)
language sql stable as $$
  select d.id, d.name, d.collection_run_id, cr.collected_at, cr.status,
         cr.scope_query, cr.scope_country,
         count(da.ad_ref),
         count(distinct a.page_ref)
    from public.datasets d
    join public.collection_runs cr on cr.id = d.collection_run_id
    left join public.dataset_ads da on da.dataset_id = d.id
    left join public.ads a on a.id = da.ad_ref
   where d.deleted_at is null and d.category_id = p_category_id
   group by d.id, d.name, d.collection_run_id, cr.collected_at, cr.status,
            cr.scope_query, cr.scope_country
   order by cr.collected_at desc
$$;

-- ---------------------------------------------------------------------------
-- The pages, ranked.
--
-- `share_denominator` is the category's distinct observed ads, returned on every
-- row so a percentage can never be rendered without the pair it came from. It
-- is a share of what WE OBSERVED — not of a market, not of spend, and not of
-- anything Meta would recognise as a total.
create function public.category_pages(
  p_category_id uuid,
  p_recent_days int default 30,
  p_search text default null,
  p_sort text default 'observed_ads',
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  page_id text,
  page_name text,
  page_categories text[],
  observed_ads bigint,
  active_ads bigint,
  inactive_ads bigint,
  unknown_ads bigint,
  recently_found bigint,
  started_recently bigint,
  evergreen_ads bigint,
  reused_ads bigint,
  max_collation int,
  last_observed_at timestamptz,
  share_denominator bigint,
  total_count bigint
)
language sql stable as $$
  with scope as (
    select * from public.page_scope_observations('category', p_category_id)
  ), ads_in_scope as (
    select a.page_ref, o.is_active, o.collation_count,
           a.start_date, a.first_seen_at, s.collected_at,
           (current_date - a.start_date::date)::int as ad_age_days
      from scope s
      join public.ad_observations o on o.id = s.observation_id
      join public.ads a on a.id = s.ad_ref
  ), latest_page as (
    select distinct on (po.page_ref)
           po.page_ref, po.page_name, po.page_categories
      from public.page_observations po
      join public.datasets d on d.collection_run_id = po.collection_run_id
     where d.deleted_at is null and d.category_id = p_category_id
     order by po.page_ref, po.observed_at desc, po.id desc
  ), rolled as (
    select p.page_id, lp.page_name, lp.page_categories,
           count(*)                                                   as observed_ads,
           count(*) filter (where x.is_active is true)                as active_ads,
           count(*) filter (where x.is_active is false)               as inactive_ads,
           count(*) filter (where x.is_active is null)                as unknown_ads,
           count(*) filter (
             where x.first_seen_at >= now() - make_interval(days => greatest(p_recent_days, 0)))
                                                                      as recently_found,
           count(*) filter (
             where x.start_date >= now() - make_interval(days => greatest(p_recent_days, 0)))
                                                                      as started_recently,
           count(*) filter (
             where x.is_active is true
               and x.ad_age_days >= public.evergreen_threshold_days()) as evergreen_ads,
           count(*) filter (where coalesce(x.collation_count, 0) > 1)  as reused_ads,
           max(x.collation_count)                                      as max_collation,
           max(x.collected_at)                                         as last_observed_at
      from ads_in_scope x
      join public.pages p on p.id = x.page_ref
      left join latest_page lp on lp.page_ref = x.page_ref
     group by p.page_id, lp.page_name, lp.page_categories
  ), filtered as (
    select * from rolled
     where p_search is null
        or page_name ilike '%' || p_search || '%'
        or page_id = p_search
  )
  select f.page_id, f.page_name, f.page_categories,
         f.observed_ads, f.active_ads, f.inactive_ads, f.unknown_ads,
         f.recently_found, f.started_recently, f.evergreen_ads, f.reused_ads,
         f.max_collation, f.last_observed_at,
         -- Every page's denominator is the whole category, never the filtered
         -- subset: a share of a search result is not a share of anything.
         (select count(*) from ads_in_scope) as share_denominator,
         (select count(*) from filtered) as total_count
    from filtered f
   order by
     case when p_sort = 'recently_found'   then f.recently_found   end desc nulls last,
     case when p_sort = 'started_recently' then f.started_recently end desc nulls last,
     case when p_sort = 'evergreen'        then f.evergreen_ads    end desc nulls last,
     case when p_sort = 'reuse'            then f.max_collation    end desc nulls last,
     case when p_sort = 'last_observed'    then f.last_observed_at end desc nulls last,
     case when p_sort = 'page_name'        then f.page_name        end asc  nulls last,
     f.observed_ads desc, f.page_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

-- ---------------------------------------------------------------------------
-- The category's creative mix, over the current observed view.
--
-- Same contract as page_creative_mix: every row carries its own denominator,
-- and `exclusive` decides whether the shares are allowed to be read as parts of
-- a whole. `page_category` here is META's label for the page — it is returned
-- under that name so no caller can mistake it for the research category the
-- workspace is about.
create function public.category_creative_mix(p_category_id uuid)
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
    select * from public.page_scope_observations('category', p_category_id)
  ), ads_in_scope as (
    select o.display_format, o.cta_type, o.publisher_platform, po.page_categories
      from scope s
      join public.ad_observations o on o.id = s.observation_id
      join public.ads a on a.id = s.ad_ref
      left join public.page_observations po
        on po.page_ref = a.page_ref and po.collection_run_id = s.collection_run_id
  ), totals as (
    select count(*) as observed,
           count(*) filter (where display_format is not null) as format_covered,
           count(*) filter (where cta_type is not null)       as cta_covered,
           count(*) filter (where publisher_platform is not null
                              and cardinality(publisher_platform) > 0) as platform_covered,
           count(*) filter (where page_categories is not null
                              and cardinality(page_categories) > 0)    as page_category_covered
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
  select 'page_category', page_category, count(*), t.page_category_covered, t.observed, false
    from ads_in_scope x, totals t, unnest(x.page_categories) as page_category
   group by 2, t.page_category_covered, t.observed
$$;

-- ---------------------------------------------------------------------------
-- The category's two ad-property series. P2.2 semantics, no page filter.
--
-- Reads page_scope_ads, NOT the current-view reduction: a history built from
-- the newest observation of each ad is not a history.
create function public.category_activity(
  p_category_id uuid,
  p_bucket text default 'week',
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  bucket_start timestamptz,
  started_ads bigint,
  first_seen_ads bigint
)
language sql stable as $$
  with unit as (
    select case when p_bucket = 'day' then 'day' else 'week' end as u
  ), ads_in_scope as (
    select a.start_date, a.first_seen_at
      from public.page_scope_ads('category', p_category_id) s
      join public.ads a on a.id = s.ad_ref
  ), points as (
    select date_trunc((select u from unit), start_date) as bucket_start, 1 as started, 0 as first_seen
      from ads_in_scope
     where (p_from is null or start_date >= p_from)
       and (p_to   is null or start_date <  p_to)
    union all
    select date_trunc((select u from unit), first_seen_at), 0, 1
      from ads_in_scope
     where (p_from is null or first_seen_at >= p_from)
       and (p_to   is null or first_seen_at <  p_to)
  )
  select bucket_start, sum(started)::bigint, sum(first_seen)::bigint
    from points
   group by bucket_start
   order by bucket_start
$$;

-- ---------------------------------------------------------------------------
-- What each run in the category observed.
--
-- One row per run, never per dataset — the lesson P2.2 learned the hard way —
-- and only runs that observed something in this category.
create function public.category_run_history(p_category_id uuid)
returns table (
  collection_run_id uuid,
  dataset_id uuid,
  dataset_name text,
  collected_at timestamptz,
  scope_query text,
  scope_country text,
  observed_ads bigint,
  observed_pages bigint,
  active_ads bigint,
  inactive_ads bigint,
  unknown_ads bigint
)
language sql stable as $$
  with runs as (
    select distinct on (d.collection_run_id)
           d.collection_run_id, d.id as dataset_id, d.name as dataset_name,
           cr.collected_at, cr.scope_query, cr.scope_country
      from public.datasets d
      join public.collection_runs cr on cr.id = d.collection_run_id
     where d.deleted_at is null and d.category_id = p_category_id
     order by d.collection_run_id, d.created_at asc
  ), observations as (
    select o.ad_ref, o.collection_run_id, o.is_active, a.page_ref
      from public.ad_observations o
      join runs r on r.collection_run_id = o.collection_run_id
      join public.ads a on a.id = o.ad_ref
  ), rolled as (
    select collection_run_id,
           count(*)                                     as observed_ads,
           count(distinct page_ref)                     as observed_pages,
           count(*) filter (where is_active is true)    as active_ads,
           count(*) filter (where is_active is false)   as inactive_ads,
           count(*) filter (where is_active is null)    as unknown_ads
      from observations
     group by collection_run_id
  )
  select r.collection_run_id, r.dataset_id, r.dataset_name, r.collected_at,
         r.scope_query, r.scope_country,
         x.observed_ads, x.observed_pages, x.active_ads, x.inactive_ads, x.unknown_ads
    from rolled x
    join runs r on r.collection_run_id = x.collection_run_id
   order by r.collected_at desc
$$;

-- ---------------------------------------------------------------------------
-- The evidence behind every number above.
--
-- Reads the same current view the summaries did, so a count and its ads are the
-- same query with a different projection. The signal names are the frozen P2.1
-- ones: no new definition, no second meaning of "evergreen".
create function public.category_evidence(
  p_category_id uuid,
  p_signal text default null,
  p_recent_days int default 30,
  p_format text default null,
  p_cta text default null,
  p_platform text default null,
  p_page_id text default null,
  -- A timeline bucket, when the reader arrived from the activity chart. The
  -- metric names which clock the window applies to, so a started bucket can
  -- never be filled with first-seen ads.
  p_window_metric text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_sort text default 'started_desc',
  p_limit int default 24,
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
    select * from public.page_scope_observations('category', p_category_id)
  ), rows_in_scope as (
    select a.ad_archive_id, o.is_active, o.display_format, o.publisher_platform,
           o.cta_type, o.cta_text, o.title, o.body_text,
           p.page_id, po.page_name, po.page_categories,
           a.start_date, o.collation_count,
           a.first_seen_at, a.last_seen_at,
           (current_date - a.start_date::date)::int as ad_age_days,
           o.media, m.storage_path as archive_path, m.archive_status
      from scope s
      join public.ad_observations o on o.id = s.observation_id
      join public.ads a on a.id = s.ad_ref
      join public.pages p on p.id = a.page_ref
      left join public.page_observations po
        on po.page_ref = a.page_ref and po.collection_run_id = s.collection_run_id
      left join public.media_assets m on m.ad_observation_id = o.id
  ), filtered as (
    select * from rows_in_scope
     where (p_page_id  is null or page_id = p_page_id)
       and (p_window_metric is distinct from 'started'
            or ((p_from is null or start_date >= p_from)
                and (p_to is null or start_date < p_to)))
       and (p_window_metric is distinct from 'first_seen'
            or ((p_from is null or first_seen_at >= p_from)
                and (p_to is null or first_seen_at < p_to)))
       and (p_format   is null or display_format = p_format)
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
-- Permissions. Same contract as every read function before these.
do $$
declare
  fn text;
  signatures text[] := array[
    'public.category_list()',
    'public.category_detail(uuid, int)',
    'public.category_datasets(uuid)',
    'public.category_pages(uuid, int, text, text, int, int)',
    'public.category_creative_mix(uuid)',
    'public.category_activity(uuid, text, timestamptz, timestamptz)',
    'public.category_run_history(uuid)',
    'public.category_evidence(uuid, text, int, text, text, text, text, text, timestamptz, timestamptz, text, int, int)'
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
