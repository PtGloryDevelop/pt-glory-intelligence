-- Restores the 0018 shapes of dataset_ads_page and dataset_ads_facets, with the
-- 0019 permissions, and drops the settings reader. Nothing is stored by 0022.

drop function if exists public.dataset_ads_page(uuid, text, text, text, text, text, text, int, int, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, int, int, boolean, int, boolean, boolean, boolean, boolean, text);
drop function if exists public.dataset_ads_facets(uuid);
drop function if exists public.evergreen_threshold_days();

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

do $$
declare
  fn text;
  signatures text[] := array[
    'public.dataset_ads_page(uuid, text, text, text, text, text, text, int, int)',
    'public.dataset_ads_facets(uuid)'
  ];
begin
  foreach fn in array signatures loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
    execute format('alter function %s set search_path = public, pg_temp', fn);
  end loop;
end $$;
