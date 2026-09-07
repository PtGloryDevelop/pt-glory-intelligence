-- Projects the durable preview into the existing snapshot reads.
--
-- No new table, no new column, no stored value, and no change to any filter,
-- sort or business rule. Both functions gain one reference each — storage_path
-- and archive_status — so the presentation layer can prefer an object we hold
-- over a source URL that is probably already dead.
--
-- The definitions below were taken from the live catalog and edited
-- mechanically rather than retyped, so V3's filter and sort behaviour is
-- byte-identical apart from the added join and columns.
--
-- The join is on `o.id` — the observation the dataset's collection_run_id has
-- already pinned — so an archive belonging to a newer run can never appear in an
-- older dataset. Snapshot semantics are unchanged.

drop function if exists public.dataset_ads_page(uuid, text, text, text, text, text, text, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer, boolean, integer, boolean, boolean, boolean, boolean, text);
drop function if exists public.ad_detail(text, uuid);

CREATE OR REPLACE FUNCTION public.ad_detail(p_ad_archive_id text, p_dataset_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(context text, ad_archive_id text, page_id text, page_profile_uri text, page_profile_numeric_id text, page_name text, page_like_count bigint, page_categories text[], start_date timestamp with time zone, end_date timestamp with time zone, first_seen_at timestamp with time zone, last_seen_at timestamp with time zone, ad_age_days integer, is_active boolean, display_format text, publisher_platform text[], cta_type text, cta_text text, title text, body_text text, caption text, link_url text, link_description text, collation_count integer, media jsonb, archive_path text, archive_status text, observed_at timestamp with time zone, collection_run_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    case when p_dataset_id is null then 'master' else 'dataset' end,
    a.ad_archive_id, p.page_id, p.page_profile_uri, p.page_profile_numeric_id,
    po.page_name, po.page_like_count, po.page_categories,
    a.start_date, a.end_date, a.first_seen_at, a.last_seen_at,
    (current_date - a.start_date::date)::int,
    o.is_active, o.display_format, o.publisher_platform,
    o.cta_type, o.cta_text, o.title, o.body_text, o.caption,
    o.link_url, o.link_description, o.collation_count, o.media,
    ma.storage_path, ma.archive_status,
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
  left join public.media_assets ma
    on ma.ad_observation_id = o.id and ma.asset_role = 'preview'
  where a.ad_archive_id = p_ad_archive_id
    and (p_dataset_id is null
         or exists (select 1 from public.dataset_ads da
                     where da.dataset_id = p_dataset_id and da.ad_ref = a.id))
$function$
;

CREATE OR REPLACE FUNCTION public.dataset_ads_page(p_dataset_id uuid, p_active text DEFAULT NULL::text, p_format text DEFAULT NULL::text, p_cta text DEFAULT NULL::text, p_platform text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_page_id text DEFAULT NULL::text, p_started_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_started_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_first_seen_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_first_seen_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_last_seen_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_last_seen_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_age_min integer DEFAULT NULL::integer, p_age_max integer DEFAULT NULL::integer, p_evergreen boolean DEFAULT NULL::boolean, p_reuse_min integer DEFAULT NULL::integer, p_has_video boolean DEFAULT NULL::boolean, p_has_image boolean DEFAULT NULL::boolean, p_has_title boolean DEFAULT NULL::boolean, p_has_destination boolean DEFAULT NULL::boolean, p_sort text DEFAULT 'started_desc'::text)
 RETURNS TABLE(ad_archive_id text, is_active boolean, display_format text, publisher_platform text[], cta_type text, cta_text text, title text, body_text text, page_id text, page_name text, page_categories text[], start_date timestamp with time zone, collation_count integer, first_seen_at timestamp with time zone, last_seen_at timestamp with time zone, ad_age_days integer, media jsonb, archive_path text, archive_status text, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with snapshot as (
    select a.ad_archive_id, o.is_active, o.display_format, o.publisher_platform,
           o.cta_type, o.cta_text, o.title, o.body_text,
           p.page_id, po.page_name, po.page_categories,
           a.start_date, o.collation_count,
           a.first_seen_at, a.last_seen_at,
           (current_date - a.start_date::date)::int as ad_age_days,
           -- The media observed in THIS run. Never the newest observation.
           o.media, o.link_url,
           -- The durable preview belonging to THIS observation. Joined on o.id,
           -- which the collection_run_id join above has already pinned, so an
           -- archive from a newer run cannot surface in an older dataset.
           ma.storage_path as archive_path, ma.archive_status
      from public.datasets d
      join public.dataset_ads da on da.dataset_id = d.id
      join public.ads a on a.id = da.ad_ref
      join public.ad_observations o
        on o.ad_ref = a.id and o.collection_run_id = d.collection_run_id
      join public.pages p on p.id = a.page_ref
      left join public.page_observations po
        on po.page_ref = p.id and po.collection_run_id = d.collection_run_id
      left join public.media_assets ma
        on ma.ad_observation_id = o.id and ma.asset_role = 'preview'
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
         f.archive_path, f.archive_status,
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
$function$
;


-- Same permission posture as every other read function. Recreating a function
-- resets its ACL to the Postgres default, so this is not optional cleanup: it is
-- what stops 0019's work being silently undone.
do $grants$
declare
  fn text;
  signatures text[] := array[
    'public.dataset_ads_page(uuid, text, text, text, text, text, text, integer, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer, boolean, integer, boolean, boolean, boolean, boolean, text)',
    'public.ad_detail(text, uuid)'
  ];
begin
  foreach fn in array signatures loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
    if has_function_privilege('anon', fn, 'execute') then
      raise exception '% must not be executable by anon', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception '% must stay executable by authenticated', fn;
    end if;
  end loop;
end $grants$;
