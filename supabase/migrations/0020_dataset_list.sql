-- Dataset list projection (Visual Refactor B2).
--
-- Handoff §7.3 asks the dataset list for Category, Query, Country, Source,
-- Collected At, Ads, Pages, Run Status and Data Quality. Every one of those
-- already exists in categories / collection_runs / dataset_ads / dataset_quality;
-- this function only joins them. No column is added, nothing is stored twice,
-- and no value is derived that the import did not already compute.
--
-- SECURITY INVOKER like the rest of the read API, so RLS decides what the caller
-- sees. Counts are read per dataset rather than cached on `datasets`, because a
-- cached count is a second source of truth that drifts the moment a membership
-- row changes.

create function public.dataset_list()
returns table (
  dataset_id uuid, dataset_name text, created_at timestamptz,
  category_id uuid, category_name text,
  collection_run_id uuid, collection_method text, source_product text,
  scope_query text, scope_country text, collected_at timestamptz,
  run_status text,
  ads_in_dataset bigint, pages_in_dataset bigint,
  quality_tier text
)
language sql stable as $$
  select d.id, d.name, d.created_at,
         c.id, c.name,
         r.id, r.collection_method, r.source_product,
         r.scope_query, r.scope_country, r.collected_at,
         r.status,
         (select count(*) from public.dataset_ads da where da.dataset_id = d.id),
         -- Distinct pages actually reachable from this dataset's ads. Not
         -- collection_runs.computed_unique_pages: that counts the whole run,
         -- which is the same number today and would silently stop being the
         -- same the first time a run feeds more than one dataset.
         (select count(distinct a.page_ref)
            from public.dataset_ads da
            join public.ads a on a.id = da.ad_ref
           where da.dataset_id = d.id),
         -- The worst field tier in the dataset, which is what the list column
         -- warns about. 'unknown' when quality was never computed — an absent
         -- measurement is not a clean one.
         -- count(*) = 0 is checked first on purpose: an aggregate over no rows
         -- still returns one row, so bool_or would be NULL and the case would
         -- fall through to 'normal' — reporting an unmeasured dataset as clean.
         (select case
                   when count(*) = 0 then 'unknown'
                   when bool_or(q.tier = 'low') then 'low'
                   when bool_or(q.tier = 'partial') then 'partial'
                   else 'normal'
                 end
            from public.dataset_quality q
           where q.dataset_id = d.id)
    from public.datasets d
    join public.categories c on c.id = d.category_id
    join public.collection_runs r on r.id = d.collection_run_id
   order by d.created_at desc
$$;

-- Same lockdown as 0019: PUBLIC and anon get nothing, `authenticated` executes,
-- and resolution cannot be steered by the caller's search_path.
revoke all on function public.dataset_list() from public;
revoke all on function public.dataset_list() from anon;
grant execute on function public.dataset_list() to authenticated;
alter function public.dataset_list() set search_path = public, pg_temp;

do $$
begin
  if has_function_privilege('anon', 'public.dataset_list()', 'execute') then
    raise exception 'public.dataset_list() must not be executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.dataset_list()', 'execute') then
    raise exception 'public.dataset_list() must stay executable by authenticated';
  end if;
end $$;
