-- Snapshot read API.
--
-- These live in the database so one definition serves the HTTP routes, the
-- integration tests and any later surface. They are SECURITY INVOKER, so RLS
-- still decides what the caller may see.
--
-- Every dataset-context read pins observations to dataset.collection_run_id
-- (invariant I1). A "latest global observation" read would make a historical
-- dataset change under the user every time a newer run is imported.

-- Context bar + canonical quality for one dataset.
create function public.dataset_context(p_dataset_id uuid)
returns table (
  dataset_id uuid, dataset_name text, category_name text,
  collection_run_id uuid, collection_method text, source_product text,
  scope_query text, scope_country text, collected_at timestamptz,
  run_status text, computed_unique_ads int, computed_unique_pages int,
  computed_source_rows int, computed_unresolved_count int,
  quarantine_count bigint, ads_in_dataset bigint
)
language sql stable as $$
  select d.id, d.name, c.name,
         r.id, r.collection_method, r.source_product,
         r.scope_query, r.scope_country, r.collected_at,
         r.status, r.computed_unique_ads, r.computed_unique_pages,
         r.computed_source_rows, r.computed_unresolved_count,
         (select count(*) from public.import_quarantine q where q.collection_run_id = r.id),
         (select count(*) from public.dataset_ads da where da.dataset_id = d.id)
    from public.datasets d
    join public.categories c on c.id = d.category_id
    join public.collection_runs r on r.id = d.collection_run_id
   where d.id = p_dataset_id
$$;

-- One page of the dataset's ads, read through that dataset's snapshot.
--
-- p_active: 'active' | 'inactive' | 'unknown' | null (any)
-- p_platform / p_category match "the array contains this value"; those columns
-- are multi-value, so shares built from them can exceed 100%.
create function public.dataset_ads_page(
  p_dataset_id uuid,
  p_active text default null,
  p_format text default null,
  p_cta text default null,
  p_platform text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  ad_archive_id text, is_active boolean, display_format text,
  publisher_platform text[], cta_type text, cta_text text, title text,
  body_text text, page_id text, page_name text, page_categories text[],
  start_date timestamptz, collation_count int, total_count bigint
)
language sql stable as $$
  with snapshot as (
    select a.ad_archive_id, o.is_active, o.display_format, o.publisher_platform,
           o.cta_type, o.cta_text, o.title, o.body_text,
           p.page_id, po.page_name, po.page_categories,
           a.start_date, o.collation_count
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
  )
  select f.*, (select count(*) from filtered) as total_count
    from filtered f
   order by f.start_date desc, f.ad_archive_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

-- Filter option lists, counted inside the current snapshot so the UI never
-- offers a value that cannot match.
create function public.dataset_ads_facets(p_dataset_id uuid)
returns table (facet text, value text, n bigint)
language sql stable as $$
  with snapshot as (
    select o.is_active, o.display_format, o.cta_type, o.publisher_platform,
           po.page_categories
      from public.datasets d
      join public.dataset_ads da on da.dataset_id = d.id
      join public.ads a on a.id = da.ad_ref
      join public.ad_observations o
        on o.ad_ref = a.id and o.collection_run_id = d.collection_run_id
      left join public.page_observations po
        on po.page_ref = a.page_ref and po.collection_run_id = d.collection_run_id
     where d.id = p_dataset_id
  )
  select 'active',
         case when is_active is true then 'active'
              when is_active is false then 'inactive' else 'unknown' end,
         count(*)
    from snapshot group by 2
  union all
  select 'display_format', coalesce(display_format, '—'), count(*)
    from snapshot group by 2
  union all
  select 'cta_type', coalesce(cta_type, '—'), count(*) from snapshot group by 2
  union all
  select 'publisher_platform', platform, count(*)
    from snapshot, unnest(publisher_platform) as platform group by 2
  union all
  select 'page_category', category, count(*)
    from snapshot, unnest(page_categories) as category group by 2
$$;

-- One ad, either through a dataset snapshot or as master current state.
--
-- With p_dataset_id the ad must belong to that dataset: a non-member returns
-- no rows so the route can answer 404 instead of quietly showing the latest
-- state under a snapshot heading.
create function public.ad_detail(p_ad_archive_id text, p_dataset_id uuid default null)
returns table (
  context text, ad_archive_id text, page_id text, page_profile_uri text,
  page_profile_numeric_id text, page_name text, page_like_count bigint,
  page_categories text[], start_date timestamptz, end_date timestamptz,
  first_seen_at timestamptz, last_seen_at timestamptz, ad_age_days int,
  is_active boolean, display_format text, publisher_platform text[],
  cta_type text, cta_text text, title text, body_text text, caption text,
  link_url text, link_description text, collation_count int, media jsonb,
  observed_at timestamptz, collection_run_id uuid
)
language sql stable as $$
  select
    case when p_dataset_id is null then 'master' else 'dataset' end,
    a.ad_archive_id, p.page_id, p.page_profile_uri, p.page_profile_numeric_id,
    po.page_name, po.page_like_count, po.page_categories,
    a.start_date, a.end_date, a.first_seen_at, a.last_seen_at,
    (current_date - a.start_date::date)::int,
    o.is_active, o.display_format, o.publisher_platform,
    o.cta_type, o.cta_text, o.title, o.body_text, o.caption,
    o.link_url, o.link_description, o.collation_count, o.media,
    o.observed_at, o.collection_run_id
  from public.ads a
  join public.pages p on p.id = a.page_ref
  left join lateral (
    select * from public.ad_observations obs
     where obs.ad_ref = a.id
       and (p_dataset_id is null
            or obs.collection_run_id = (select collection_run_id from public.datasets
                                         where id = p_dataset_id))
     order by obs.observed_at desc
     limit 1
  ) o on true
  left join lateral (
    select * from public.page_observations pobs
     where pobs.page_ref = p.id
       and (p_dataset_id is null or pobs.collection_run_id = o.collection_run_id)
     order by pobs.observed_at desc
     limit 1
  ) po on true
  where a.ad_archive_id = p_ad_archive_id
    and (p_dataset_id is null
         or exists (select 1 from public.dataset_ads da
                     where da.dataset_id = p_dataset_id and da.ad_ref = a.id))
$$;

-- Observation history for the drawer: newest first, naming its run.
create function public.ad_observation_history(p_ad_archive_id text)
returns table (
  observed_at timestamptz, collection_run_id uuid, collection_method text,
  is_active boolean, display_format text, publisher_platform text[],
  cta_type text, collation_count int
)
language sql stable as $$
  select o.observed_at, o.collection_run_id, r.collection_method,
         o.is_active, o.display_format, o.publisher_platform,
         o.cta_type, o.collation_count
    from public.ads a
    join public.ad_observations o on o.ad_ref = a.id
    join public.collection_runs r on r.id = o.collection_run_id
   where a.ad_archive_id = p_ad_archive_id
   order by o.observed_at desc, o.id desc
$$;
