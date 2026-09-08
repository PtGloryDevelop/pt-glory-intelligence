-- Page timeline read layer (P2.2). Read-only: no table, no column, no stored
-- value, no aggregate cache.
--
-- THREE CLOCKS, THREE SOURCES. This is the whole design, and the reason the
-- functions below do not share one convenient CTE:
--
--   start_date              Meta says the ad started running.       property of the AD
--   first_seen_at           PT Glory first observed the ad, ever.   property of the AD
--   collected_at            a collection run happened.              property of the RUN
--
-- P2.1 reduced the scope to one observation per ad, which is right for "what is
-- true now" and wrong for "what changed". A status-over-time series read off
-- that reduction would report every ad as having always been in its newest
-- state. So the run series here reads the historical observations, and the two
-- ad-property series read the ads — never the reduction.
--
-- Nothing in here infers. A count that fell between two runs is a count that
-- fell between two runs; whether the advertiser did anything is not knowable
-- from these rows and is not claimed by them.

-- ---------------------------------------------------------------------------
-- The ads a scope contains, without reducing them to one observation.
--
-- An ad that appears in four datasets of a category is one ad. Distinct here is
-- what stops a per-ad metric from counting dataset membership instead.
create function public.page_scope_ads(
  p_scope text,
  p_scope_id uuid default null
)
returns table (ad_ref uuid)
language sql stable as $$
  select distinct da.ad_ref
    from public.dataset_ads da
    join public.datasets d on d.id = da.dataset_id
   where d.deleted_at is null
     and (p_scope = 'all'
          or (p_scope = 'dataset'  and d.id = p_scope_id)
          or (p_scope = 'category' and d.category_id = p_scope_id))
$$;

-- ---------------------------------------------------------------------------
-- The two ad-property series, bucketed.
--
-- Both count DISTINCT ADS. An ad has one start date and one first sighting, so
-- it appears once in each series — in two different buckets, usually months
-- apart. They are returned side by side and must never be summed: an ad that
-- started in March and was found in September is not two events.
create function public.page_timeline(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null,
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
    select a.id, a.start_date, a.first_seen_at
      from public.page_scope_ads(p_scope, p_scope_id) s
      join public.ads a on a.id = s.ad_ref
      join public.pages p on p.id = a.page_ref
     where p.page_id = p_page_id
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
-- What each collection run actually saw.
--
-- One row per run in scope that observed this page, with the run's own identity
-- beside it: two runs are only comparable if their query and country were, and
-- the reader cannot judge that without seeing them.
--
-- "newly_encountered" is scope-local and says so: the earliest observation of
-- that ad WITHIN THIS SCOPE happened in this run. It is not a claim that the
-- advertiser launched it then, and it is not the global first_seen_at.
create function public.page_run_history(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null
)
returns table (
  collection_run_id uuid,
  dataset_id uuid,
  dataset_name text,
  collected_at timestamptz,
  collection_method text,
  scope_query text,
  scope_country text,
  observed_ads bigint,
  active_ads bigint,
  inactive_ads bigint,
  unknown_ads bigint,
  newly_encountered bigint
)
language sql stable as $$
  with runs as (
    -- One row per run, not per dataset: two datasets built from the same run are
    -- one collection, and listing it twice would double every count beside it.
    select distinct on (d.collection_run_id)
           d.collection_run_id, d.id as dataset_id, d.name as dataset_name,
           cr.collected_at, cr.collection_method, cr.scope_query, cr.scope_country
      from public.datasets d
      join public.collection_runs cr on cr.id = d.collection_run_id
     where d.deleted_at is null
       and (p_scope = 'all'
            or (p_scope = 'dataset'  and d.id = p_scope_id)
            or (p_scope = 'category' and d.category_id = p_scope_id))
     order by d.collection_run_id, d.created_at asc
  ), observations as (
    -- Historical observations, not the latest-per-ad reduction. This is the
    -- distinction the whole file exists for.
    select o.id, o.ad_ref, o.collection_run_id, o.observed_at, o.is_active
      from public.ad_observations o
      join runs r on r.collection_run_id = o.collection_run_id
      join public.ads a on a.id = o.ad_ref
      join public.pages p on p.id = a.page_ref
     where p.page_id = p_page_id
  ), first_run as (
    -- The earliest run in scope that saw each ad.
    select distinct on (ad_ref) ad_ref, collection_run_id
      from observations
     order by ad_ref, observed_at asc, id asc
  ), rolled as (
    select o.collection_run_id,
           count(*)                                        as observed_ads,
           count(*) filter (where o.is_active is true)     as active_ads,
           count(*) filter (where o.is_active is false)    as inactive_ads,
           -- Unknown is its own answer. A run that could not read a state did
           -- not observe an inactive ad.
           count(*) filter (where o.is_active is null)     as unknown_ads,
           count(*) filter (where fr.collection_run_id = o.collection_run_id)
                                                           as newly_encountered
      from observations o
      left join first_run fr on fr.ad_ref = o.ad_ref
     group by o.collection_run_id
  )
  -- Only runs that actually observed this page. A run that never saw it is not
  -- a row of zeroes on its timeline; it is not part of its history at all.
  select r.collection_run_id, r.dataset_id, r.dataset_name, r.collected_at,
         r.collection_method, r.scope_query, r.scope_country,
         x.observed_ads, x.active_ads, x.inactive_ads, x.unknown_ads,
         x.newly_encountered
    from rolled x
    join runs r on r.collection_run_id = x.collection_run_id
   order by r.collected_at desc
$$;

-- ---------------------------------------------------------------------------
-- The creative mix AS ONE RUN SAW IT.
--
-- Same shape as page_creative_mix, computed from that run's own observations
-- rather than from the scope's newest ones — which is what makes it a fact
-- about a moment instead of a fact about now. Coverage is per run for the same
-- reason: a field readable in 90% of one run's rows may be readable in 40% of
-- another's, and one badge over both would describe neither.
create function public.page_run_mix(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null,
  p_run_id uuid default null
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
  with runs as (
    select d.collection_run_id
      from public.datasets d
     where d.deleted_at is null
       and (p_scope = 'all'
            or (p_scope = 'dataset'  and d.id = p_scope_id)
            or (p_scope = 'category' and d.category_id = p_scope_id))
  ), rows_in_run as (
    select o.display_format, o.cta_type, o.publisher_platform
      from public.ad_observations o
      join runs r on r.collection_run_id = o.collection_run_id
      join public.ads a on a.id = o.ad_ref
      join public.pages p on p.id = a.page_ref
     where p.page_id = p_page_id
       and o.collection_run_id = p_run_id
  ), totals as (
    select count(*) as observed,
           count(*) filter (where display_format is not null) as format_covered,
           count(*) filter (where cta_type is not null)       as cta_covered,
           count(*) filter (where publisher_platform is not null
                              and cardinality(publisher_platform) > 0) as platform_covered
      from rows_in_run
  )
  select 'display_format', coalesce(x.display_format, '—'), count(*),
         t.format_covered, t.observed, true
    from rows_in_run x, totals t
   group by 2, t.format_covered, t.observed
  union all
  select 'cta_type', x.cta_type, count(*), t.cta_covered, t.observed, true
    from rows_in_run x, totals t
   where x.cta_type is not null
   group by 2, t.cta_covered, t.observed
  union all
  select 'publisher_platform', platform, count(*), t.platform_covered, t.observed, false
    from rows_in_run x, totals t, unnest(x.publisher_platform) as platform
   group by 2, t.platform_covered, t.observed
$$;

-- ---------------------------------------------------------------------------
-- The ads behind one timeline bucket.
--
-- p_metric decides which clock the window applies to, and therefore which rows
-- come back. It is an allowlisted word, never an expression:
--
--   started     ads whose Meta start_date falls in the window
--   first_seen  ads PT Glory first observed in the window
--   run         ads observed in one collection run, optionally in one state
--
-- The first two describe the ad, so they are shown through the newest
-- observation in scope — the same rule the rest of Page Intelligence uses. The
-- third describes a moment, so it is shown through that run's own observation.
create function public.page_timeline_evidence(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null,
  p_metric text default 'started',
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_run_id uuid default null,
  p_status text default null,
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
  with chosen as (
    -- One observation per ad, and which one depends on the question asked.
    select s.ad_ref, s.observation_id
      from public.page_scope_observations(p_scope, p_scope_id) s
     where p_metric in ('started', 'first_seen')
    union all
    select o.ad_ref, o.id
      from public.ad_observations o
      join public.datasets d on d.collection_run_id = o.collection_run_id
     where p_metric = 'run'
       and o.collection_run_id = p_run_id
       and d.deleted_at is null
       and (p_scope = 'all'
            or (p_scope = 'dataset'  and d.id = p_scope_id)
            or (p_scope = 'category' and d.category_id = p_scope_id))
  ), rows_in_scope as (
    select distinct on (a.ad_archive_id)
           a.ad_archive_id, o.is_active, o.display_format, o.publisher_platform,
           o.cta_type, o.cta_text, o.title, o.body_text,
           p.page_id, po.page_name, po.page_categories,
           a.start_date, o.collation_count,
           a.first_seen_at, a.last_seen_at,
           (current_date - a.start_date::date)::int as ad_age_days,
           o.media, m.storage_path as archive_path, m.archive_status
      from chosen c
      join public.ad_observations o on o.id = c.observation_id
      join public.ads a on a.id = c.ad_ref
      join public.pages p on p.id = a.page_ref
      left join public.page_observations po
        on po.page_ref = a.page_ref and po.collection_run_id = o.collection_run_id
      left join public.media_assets m on m.ad_observation_id = o.id
     where p.page_id = p_page_id
     order by a.ad_archive_id, o.observed_at desc, o.id desc
  ), filtered as (
    select * from rows_in_scope
     where (p_metric <> 'started'
            or ((p_from is null or start_date >= p_from)
                and (p_to is null or start_date < p_to)))
       and (p_metric <> 'first_seen'
            or ((p_from is null or first_seen_at >= p_from)
                and (p_to is null or first_seen_at < p_to)))
       -- Status applies to the run being inspected, and only there.
       and (p_metric <> 'run' or p_status is null
            or (p_status = 'active'   and is_active is true)
            or (p_status = 'inactive' and is_active is false)
            or (p_status = 'unknown'  and is_active is null))
  )
  select f.ad_archive_id, f.is_active, f.display_format, f.publisher_platform,
         f.cta_type, f.cta_text, f.title, f.body_text, f.page_id, f.page_name,
         f.page_categories, f.start_date, f.collation_count,
         f.first_seen_at, f.last_seen_at, f.ad_age_days, f.media,
         f.archive_path, f.archive_status,
         (select count(*) from filtered) as total_count
    from filtered f
   order by f.start_date desc, f.ad_archive_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

-- ---------------------------------------------------------------------------
-- Permissions. Same contract as every read function before it.
do $$
declare
  fn text;
  signatures text[] := array[
    'public.page_scope_ads(text, uuid)',
    'public.page_timeline(text, uuid, text, text, timestamptz, timestamptz)',
    'public.page_run_history(text, uuid, text)',
    'public.page_run_mix(text, uuid, text, uuid)',
    'public.page_timeline_evidence(text, uuid, text, text, timestamptz, timestamptz, uuid, text, int, int)'
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
