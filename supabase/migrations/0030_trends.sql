-- Trends read layer (P2.5). Read-only: no table, no stored value, no cached
-- trend, no mutable state.
--
-- EVENTS AND STATES ARE NOT THE SAME KIND OF THING, and the whole file is built
-- around keeping them apart.
--
--   EVENT   start_date, first_seen_at. A moment that happened once. It belongs
--           to a period the way a birthday belongs to a month: you count the
--           ads whose moment falls inside the window.
--
--   STATE   active/inactive/unknown, evergreen, reuse, format, CTA, platform.
--           These have no moment. They are only ever true AS OF some point, so
--           a period needs a reference instant, and the honest reconstruction
--           is "the latest observation at or before that instant, in scope".
--
-- Reading a state metric as if it were an event — counting observations inside
-- a window — would make a page that was collected twice look twice as active as
-- one collected once. Reading it from today's data for both periods would make
-- every history identical to the present. This file does neither.
--
-- Nothing here is a forecast, a significance test or an explanation. A trend is
-- the difference between two deterministic counts, and the wording that goes
-- with it is the caller's job.

-- ---------------------------------------------------------------------------
-- The state of a scope AS OF one instant.
--
-- Same shape and same rule as page_scope_observations, with a clock on it: the
-- newest observation of each ad that had already happened by p_reference. With
-- p_reference in the future this is exactly the current view, which is why the
-- two agree at the present moment and diverge going back.
create function public.trend_state_scope(
  p_scope text,
  p_scope_id uuid default null,
  p_reference timestamptz default null
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
       -- The run itself must already have happened. A dataset collected after
       -- the reference instant is not part of what we knew then.
       and (p_reference is null or cr.collected_at < p_reference)
  ), members as (
    select distinct da.ad_ref
      from public.dataset_ads da
      join public.datasets d on d.id = da.dataset_id
      join runs r on r.collection_run_id = d.collection_run_id
  )
  select distinct on (o.ad_ref)
         o.ad_ref, o.id, o.collection_run_id, r.collected_at
    from public.ad_observations o
    join runs r on r.collection_run_id = o.collection_run_id
    join members m on m.ad_ref = o.ad_ref
   where p_reference is null or o.observed_at < p_reference
   order by o.ad_ref, o.observed_at desc, o.id desc
$$;

-- ---------------------------------------------------------------------------
-- The summary: every metric, both periods, in one read.
--
-- `kind` travels with each row because the two kinds answer different
-- questions, and a screen that showed them in one column without saying which
-- was which would invite exactly the wrong reading.
--
-- Event rows count ads whose moment fell in the window. State rows count ads by
-- what was true at the window's end.
create function public.trend_summary(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null,
  p_current_from timestamptz default null,
  p_current_to timestamptz default null,
  p_previous_from timestamptz default null,
  p_previous_to timestamptz default null
)
returns table (
  metric text,
  kind text,
  current_value bigint,
  previous_value bigint
)
language sql stable as $$
  with scope_ads as (
    -- Membership comes from the scope; the event timestamps on these ads are
    -- global. Keeping the two apart is what stops a category trend from
    -- quietly counting ads it does not contain.
    select a.id, a.start_date, a.first_seen_at
      from public.page_scope_ads(p_scope, p_scope_id) s
      join public.ads a on a.id = s.ad_ref
      join public.pages p on p.id = a.page_ref
     where p_page_id is null or p.page_id = p_page_id
  ), events as (
    select 'first_seen' as metric, 'event' as kind,
           count(*) filter (where first_seen_at >= p_current_from and first_seen_at < p_current_to) as current_value,
           count(*) filter (where first_seen_at >= p_previous_from and first_seen_at < p_previous_to) as previous_value
      from scope_ads
    union all
    select 'started', 'event',
           count(*) filter (where start_date >= p_current_from and start_date < p_current_to),
           count(*) filter (where start_date >= p_previous_from and start_date < p_previous_to)
      from scope_ads
  ), state_at as (
    select 'current' as period, x.* from public.trend_state_scope(p_scope, p_scope_id, p_current_to) x
    union all
    select 'previous', x.* from public.trend_state_scope(p_scope, p_scope_id, p_previous_to) x
  ), state_rows as (
    select st.period, o.is_active, o.collation_count,
           -- Age at the reference instant, not today: an ad is evergreen when
           -- it was old enough THEN, and reading age from the present would
           -- make every past period look like the current one.
           (case when st.period = 'current' then p_current_to else p_previous_to end)::date
             - a.start_date::date as ad_age_days
      from state_at st
      join public.ad_observations o on o.id = st.observation_id
      join public.ads a on a.id = st.ad_ref
      join public.pages p on p.id = a.page_ref
     where p_page_id is null or p.page_id = p_page_id
  ), states as (
    select 'observed' as metric, 'state' as kind,
           count(*) filter (where period = 'current'),
           count(*) filter (where period = 'previous')
      from state_rows
    union all
    select 'active', 'state',
           count(*) filter (where period = 'current'  and is_active is true),
           count(*) filter (where period = 'previous' and is_active is true)
      from state_rows
    union all
    select 'inactive', 'state',
           count(*) filter (where period = 'current'  and is_active is false),
           count(*) filter (where period = 'previous' and is_active is false)
      from state_rows
    union all
    -- Unknown is its own answer at every point in time, here as everywhere.
    select 'unknown', 'state',
           count(*) filter (where period = 'current'  and is_active is null),
           count(*) filter (where period = 'previous' and is_active is null)
      from state_rows
    union all
    select 'evergreen', 'state',
           count(*) filter (where period = 'current'  and is_active is true
                              and ad_age_days >= public.evergreen_threshold_days()),
           count(*) filter (where period = 'previous' and is_active is true
                              and ad_age_days >= public.evergreen_threshold_days())
      from state_rows
    union all
    select 'reused', 'state',
           count(*) filter (where period = 'current'  and coalesce(collation_count, 0) > 1),
           count(*) filter (where period = 'previous' and coalesce(collation_count, 0) > 1)
      from state_rows
  )
  select * from events
  union all
  select * from states
$$;

-- ---------------------------------------------------------------------------
-- Which pages changed, ranked by arithmetic delta.
--
-- Event metrics only. A page's state count depends on when it was collected, so
-- ranking pages by a state difference would rank the collection schedule.
create function public.trend_pages(
  p_scope text,
  p_scope_id uuid default null,
  p_metric text default 'first_seen',
  p_current_from timestamptz default null,
  p_current_to timestamptz default null,
  p_previous_from timestamptz default null,
  p_previous_to timestamptz default null,
  p_direction text default 'increase',
  p_limit int default 10,
  p_offset int default 0
)
returns table (
  page_id text,
  page_name text,
  current_value bigint,
  previous_value bigint,
  change bigint,
  total_count bigint
)
language sql stable as $$
  with scope_ads as (
    select p.id as page_ref, p.page_id, a.start_date, a.first_seen_at
      from public.page_scope_ads(p_scope, p_scope_id) s
      join public.ads a on a.id = s.ad_ref
      join public.pages p on p.id = a.page_ref
  ), moment as (
    select page_ref, page_id,
           case when p_metric = 'started' then start_date else first_seen_at end as at
      from scope_ads
  ), latest_page as (
    select distinct on (po.page_ref) po.page_ref, po.page_name
      from public.page_observations po
      join public.datasets d on d.collection_run_id = po.collection_run_id
     where d.deleted_at is null
       and (p_scope = 'all'
            or (p_scope = 'dataset'  and d.id = p_scope_id)
            or (p_scope = 'category' and d.category_id = p_scope_id))
     order by po.page_ref, po.observed_at desc, po.id desc
  ), rolled as (
    select m.page_id, lp.page_name,
           count(*) filter (where m.at >= p_current_from  and m.at < p_current_to)  as current_value,
           count(*) filter (where m.at >= p_previous_from and m.at < p_previous_to) as previous_value
      from moment m
      left join latest_page lp on lp.page_ref = m.page_ref
     group by m.page_id, lp.page_name
  ), changed as (
    select *, current_value - previous_value as change
      from rolled
     -- A page with nothing in either window is not a change.
     where current_value > 0 or previous_value > 0
  )
  select c.page_id, c.page_name, c.current_value, c.previous_value, c.change,
         (select count(*) from changed) as total_count
    from changed c
   order by
     case when p_direction = 'decrease' then c.change end asc  nulls last,
     case when p_direction = 'increase' then c.change end desc nulls last,
     c.current_value desc, c.page_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

-- ---------------------------------------------------------------------------
-- The creative mix as it stood at each period's end.
--
-- Coverage is per period, for the same reason it is per side in Compare: a
-- field readable in 90% of one reference view and 40% of the other is not a
-- change in advertising, and one badge over both would hide that.
create function public.trend_mix(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null,
  p_current_to timestamptz default null,
  p_previous_to timestamptz default null
)
returns table (
  period text,
  dimension text,
  value text,
  n bigint,
  covered bigint,
  observed bigint,
  exclusive boolean
)
language sql stable as $$
  with state_at as (
    select 'current' as period, x.* from public.trend_state_scope(p_scope, p_scope_id, p_current_to) x
    union all
    select 'previous', x.* from public.trend_state_scope(p_scope, p_scope_id, p_previous_to) x
  ), rows_in_period as (
    select st.period, o.display_format, o.cta_type, o.publisher_platform
      from state_at st
      join public.ad_observations o on o.id = st.observation_id
      join public.ads a on a.id = st.ad_ref
      join public.pages p on p.id = a.page_ref
     where p_page_id is null or p.page_id = p_page_id
  ), totals as (
    select period,
           count(*) as observed,
           count(*) filter (where display_format is not null) as format_covered,
           count(*) filter (where cta_type is not null)       as cta_covered,
           count(*) filter (where publisher_platform is not null
                              and cardinality(publisher_platform) > 0) as platform_covered
      from rows_in_period
     group by period
  )
  select x.period, 'display_format', coalesce(x.display_format, '—'), count(*),
         t.format_covered, t.observed, true
    from rows_in_period x join totals t on t.period = x.period
   group by 1, 3, t.format_covered, t.observed
  union all
  select x.period, 'cta_type', x.cta_type, count(*), t.cta_covered, t.observed, true
    from rows_in_period x join totals t on t.period = x.period
   where x.cta_type is not null
   group by 1, 3, t.cta_covered, t.observed
  union all
  select x.period, 'publisher_platform', platform, count(*), t.platform_covered, t.observed, false
    from rows_in_period x join totals t on t.period = x.period,
         unnest(x.publisher_platform) as platform
   group by 1, 3, t.platform_covered, t.observed
$$;

-- ---------------------------------------------------------------------------
-- What data each period actually had.
--
-- Two periods are only comparable if they were collected comparably, and the
-- reader cannot judge that without the runs, the queries and the countries in
-- front of them. No score is computed from this; it is evidence about evidence.
create function public.trend_context(
  p_scope text,
  p_scope_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  collection_run_id uuid,
  dataset_id uuid,
  dataset_name text,
  collected_at timestamptz,
  scope_query text,
  scope_country text,
  collection_method text
)
language sql stable as $$
  select distinct on (d.collection_run_id)
         d.collection_run_id, d.id, d.name, cr.collected_at,
         cr.scope_query, cr.scope_country, cr.collection_method
    from public.datasets d
    join public.collection_runs cr on cr.id = d.collection_run_id
   where d.deleted_at is null
     and (p_scope = 'all'
          or (p_scope = 'dataset'  and d.id = p_scope_id)
          or (p_scope = 'category' and d.category_id = p_scope_id))
     and (p_from is null or cr.collected_at >= p_from)
     and (p_to   is null or cr.collected_at <  p_to)
   order by d.collection_run_id, d.created_at asc
$$;

-- ---------------------------------------------------------------------------
-- The ads behind one trend number.
--
-- p_reference decides which question is being answered, and therefore which
-- rows come back:
--
--   null        an EVENT window — ads whose first_seen_at or start_date fell
--               between p_from and p_to, shown through their newest observation
--               in scope
--   a timestamp a STATE view — what the scope looked like at that instant,
--               optionally narrowed by a state signal or a creative value
--
-- The two are never mixed, because they are never both supplied.
create function public.trend_evidence(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null,
  p_event text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_reference timestamptz default null,
  p_signal text default null,
  p_format text default null,
  p_cta text default null,
  p_platform text default null,
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
    -- An event window reads the scope as it is now; a state view reads it as it
    -- was. p_reference is what decides which, and it is never both.
    select s.ad_ref, s.observation_id
      from public.page_scope_observations(p_scope, p_scope_id) s
     where p_reference is null
    union all
    select s.ad_ref, s.observation_id
      from public.trend_state_scope(p_scope, p_scope_id, p_reference) s
     where p_reference is not null
  ), rows_in_scope as (
    select a.ad_archive_id, o.is_active, o.display_format, o.publisher_platform,
           o.cta_type, o.cta_text, o.title, o.body_text,
           p.page_id, po.page_name, po.page_categories,
           a.start_date, o.collation_count,
           a.first_seen_at, a.last_seen_at,
           -- Age against the reference the caller asked about.
           (coalesce(p_reference, now())::date - a.start_date::date)::int as ad_age_days,
           o.media, m.storage_path as archive_path, m.archive_status
      from chosen c
      join public.ad_observations o on o.id = c.observation_id
      join public.ads a on a.id = c.ad_ref
      join public.pages p on p.id = a.page_ref
      left join public.page_observations po
        on po.page_ref = a.page_ref and po.collection_run_id = o.collection_run_id
      left join public.media_assets m on m.ad_observation_id = o.id
     where p_page_id is null or p.page_id = p_page_id
  ), filtered as (
    select * from rows_in_scope
     where (p_event is distinct from 'first_seen'
            or (first_seen_at >= p_from and first_seen_at < p_to))
       and (p_event is distinct from 'started'
            or (start_date >= p_from and start_date < p_to))
       and (p_format   is null or display_format = p_format)
       and (p_cta      is null or cta_type = p_cta)
       and (p_platform is null or publisher_platform @> array[p_platform])
       and (p_signal is null
            or (p_signal = 'active'   and is_active is true)
            or (p_signal = 'inactive' and is_active is false)
            or (p_signal = 'unknown'  and is_active is null)
            or (p_signal = 'evergreen'
                and is_active is true
                and ad_age_days >= public.evergreen_threshold_days())
            or (p_signal = 'reused' and coalesce(collation_count, 0) > 1)
            or (p_signal = 'observed'))
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
-- Permissions. Same contract as every read function before these.
do $$
declare
  fn text;
  signatures text[] := array[
    'public.trend_state_scope(text, uuid, timestamptz)',
    'public.trend_summary(text, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz)',
    'public.trend_pages(text, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, text, int, int)',
    'public.trend_mix(text, uuid, text, timestamptz, timestamptz)',
    'public.trend_context(text, uuid, timestamptz, timestamptz)',
    'public.trend_evidence(text, uuid, text, text, timestamptz, timestamptz, timestamptz, text, text, text, text, int, int)'
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
