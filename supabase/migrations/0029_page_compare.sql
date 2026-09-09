-- Page compare read layer (P2.4). Read-only: no table, no column, no stored
-- value, no aggregate cache, no mutable compare state.
--
-- NOT ONE FORMULA LIVES IN THIS FILE.
--
-- Compare summarises facts that are already defined and already frozen, so
-- every function below is a projection of P2.1 and P2.2 functions with a side
-- label attached. `page_detail`, `page_creative_mix` and `page_timeline` are
-- called as they are; if any of them changes, Compare changes with it, and a
-- reader can never be shown an "evergreen" on this screen that means something
-- different from the evergreen on the page's own screen.
--
-- The one genuinely new fact is membership: whether a page is represented in
-- the scope at all. `page_detail` answers with zeroes for a page that exists
-- somewhere else in the product, and "we observed no ads" is a different
-- statement from "this page is not in this scope". Compare must be able to say
-- which one it means, so page_in_scope exists.
--
-- Both sides always receive identical arguments — same scope, same period, same
-- bucket boundaries — because they are passed once and used twice, rather than
-- assembled separately by a caller who might drift.

-- ---------------------------------------------------------------------------
-- Is this page represented in this scope at all?
create function public.page_in_scope(
  p_scope text,
  p_scope_id uuid default null,
  p_page_id text default null
)
returns boolean
language sql stable as $$
  select exists (
    select 1
      from public.page_scope_ads(p_scope, p_scope_id) s
      join public.ads a on a.id = s.ad_ref
      join public.pages p on p.id = a.page_ref
     where p.page_id = p_page_id
  )
$$;

-- ---------------------------------------------------------------------------
-- The summary matrix, both sides in one read.
--
-- Every column is page_detail's own, unchanged. `side` and `in_scope` are the
-- only things this function adds.
create function public.page_compare_summary(
  p_scope text,
  p_scope_id uuid default null,
  p_page_a text default null,
  p_page_b text default null,
  p_recent_days int default 30
)
returns table (
  side text,
  in_scope boolean,
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
  select 'a', public.page_in_scope(p_scope, p_scope_id, p_page_a), d.*
    from public.page_detail(p_scope, p_scope_id, p_page_a, p_recent_days) d
  union all
  select 'b', public.page_in_scope(p_scope, p_scope_id, p_page_b), d.*
    from public.page_detail(p_scope, p_scope_id, p_page_b, p_recent_days) d
$$;

-- ---------------------------------------------------------------------------
-- The creative mix, both sides, each keeping its own denominators.
--
-- Coverage is per side and stays per side: A may have read a CTA on 12 of 20
-- ads and B on 18 of 60, and one shared coverage number would describe neither.
create function public.page_compare_mix(
  p_scope text,
  p_scope_id uuid default null,
  p_page_a text default null,
  p_page_b text default null
)
returns table (
  side text,
  dimension text,
  value text,
  n bigint,
  covered bigint,
  observed bigint,
  exclusive boolean
)
language sql stable as $$
  select 'a', m.* from public.page_creative_mix(p_scope, p_scope_id, p_page_a) m
  union all
  select 'b', m.* from public.page_creative_mix(p_scope, p_scope_id, p_page_b) m
$$;

-- ---------------------------------------------------------------------------
-- One clock, one window, both sides.
--
-- p_metric picks which of the two ad-property clocks is being compared, and it
-- picks it ONCE — so a chart can never put A's start dates beside B's first
-- sightings. The buckets come from page_timeline, which means both sides get
-- identical half-open boundaries and a bucket's count can be reconciled against
-- the same window on either side.
--
-- A bucket where only one side has ads still appears, with a zero for the
-- other: an absent bar is a fact, and dropping the row would hide it.
create function public.page_compare_timeline(
  p_scope text,
  p_scope_id uuid default null,
  p_page_a text default null,
  p_page_b text default null,
  p_metric text default 'started',
  p_bucket text default 'week',
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  bucket_start timestamptz,
  a_ads bigint,
  b_ads bigint
)
language sql stable as $$
  with a as (
    select t.bucket_start,
           case when p_metric = 'first_seen' then t.first_seen_ads else t.started_ads end as n
      from public.page_timeline(p_scope, p_scope_id, p_page_a, p_bucket, p_from, p_to) t
  ), b as (
    select t.bucket_start,
           case when p_metric = 'first_seen' then t.first_seen_ads else t.started_ads end as n
      from public.page_timeline(p_scope, p_scope_id, p_page_b, p_bucket, p_from, p_to) t
  )
  select coalesce(a.bucket_start, b.bucket_start),
         coalesce(a.n, 0), coalesce(b.n, 0)
    from a full outer join b on b.bucket_start = a.bucket_start
   -- A bucket where neither clock fired for either side is not a row at all;
   -- page_timeline never emits one.
   where coalesce(a.n, 0) + coalesce(b.n, 0) > 0
   order by 1
$$;

-- ---------------------------------------------------------------------------
-- Permissions. Same contract as every read function before these.
--
-- Evidence deliberately has no function here: the ads behind a compared number
-- are read through the frozen page_ads and page_timeline_evidence, once per
-- side. A compare-specific evidence query would be a second definition of every
-- signal, and reconciliation would then be a coincidence rather than a
-- structural fact.
do $$
declare
  fn text;
  signatures text[] := array[
    'public.page_in_scope(text, uuid, text)',
    'public.page_compare_summary(text, uuid, text, text, int)',
    'public.page_compare_mix(text, uuid, text, text)',
    'public.page_compare_timeline(text, uuid, text, text, text, text, timestamptz, timestamptz)'
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
