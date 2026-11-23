-- Reverts 0080. ad_detail goes back to the live definition it replaced (the exact catalog text).
-- Cached transcripts are deleted, because the old kind check cannot hold them: their cost
-- records go with them. Objects the video reader stored under video/ are not touched here.

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
$function$;

do $grants$
declare
  fn text := 'public.ad_detail(text, uuid)';
begin
  execute format('revoke all on function %s from public', fn);
  execute format('revoke all on function %s from anon', fn);
  execute format('grant execute on function %s to authenticated', fn);
  if has_function_privilege('anon', fn, 'execute') then
    raise exception '% must not be executable by anon', fn;
  end if;
  if not has_function_privilege('authenticated', fn, 'execute') then
    raise exception '% must stay executable by authenticated', fn;
  end if;
end $grants$;

delete from public.ai_analyses where kind = 'transcript';
alter table public.ai_analyses drop constraint ai_analyses_kind_check;
alter table public.ai_analyses add constraint ai_analyses_kind_check
  check (kind in ('ad', 'set'));

drop table if exists public.ad_video_readings;

notify pgrst, 'reload schema';
