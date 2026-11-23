-- What AI is shown of a rival's video ad: frames cut at known times and the audio, copied into our
-- storage by the VPS video reader before the source link expires (32-108 hours). Spec:
-- docs/superpowers/specs/2026-11-23-ad-video-reading.md (Ticket 2).
--
-- Three changes, no data rewritten:
--   1. ad_video_readings: one row per OBSERVATION (the rule media_assets set in 0023, so a newer run
--      can never change what an older dataset shows). It records what was done with the source
--      link, never the link itself: the worker reads it from ad_observations.media, which stays the
--      source truth.
--   2. ai_analyses accepts kind 'transcript', so a transcription is cached and paid for once and
--      counts toward the same AI caps and credit bar as every other call.
--   3. ad_detail also returns the observation it chose, so Compare finds that observation's reading.
--      Taken from the live catalog and edited mechanically: one column added at the end of the
--      result and of the select list, nothing else.

create table public.ad_video_readings (
  id uuid primary key default gen_random_uuid(),
  ad_observation_id bigint not null unique
    references public.ad_observations(id) on delete cascade,
  --  pending    waiting for the worker, while the link may still be alive
  --  ready      frames (and audio, when the clip has a sound track) are in our storage
  --  no_video   the observation has no usable video entry or the file has no video stream
  --  expired    the source answered 403/410 before it was read
  --  too_large  over the worker's size limit
  --  failed     anything else, after the worker's retries
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'no_video', 'expired', 'too_large', 'failed')),
  source_field text check (source_field is null or source_field in ('video_sd_url', 'video_hd_url')),
  -- Parsed from the link's `oe` parameter: scheduling metadata we derived, not Meta data.
  source_expires_at timestamptz,
  source_host text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  -- The part of the clip that was read (the first 120 s at most).
  processed_ms integer check (processed_ms is null or processed_ms >= 0),
  has_audio boolean,
  -- [{t_ms, path, bytes, sha256}] in time order; paths are inside the private media bucket.
  frames jsonb not null default '[]'::jsonb check (jsonb_typeof(frames) = 'array'),
  audio_path text,
  audio_bytes bigint check (audio_bytes is null or audio_bytes >= 0),
  audio_sha256 text check (audio_sha256 is null or audio_sha256 ~ '^[0-9a-f]{64}$'),
  -- The first 5 seconds on their own: gpt-transcribe gives no timestamps, so the hook is read apart.
  hook_audio_path text,
  hook_audio_bytes bigint check (hook_audio_bytes is null or hook_audio_bytes >= 0),
  hook_audio_sha256 text check (hook_audio_sha256 is null or hook_audio_sha256 ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  processed_at timestamptz,
  -- A machine-readable code. Never a URL.
  failure_reason text check (failure_reason is null or failure_reason !~ '://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A row claiming to be ready must be able to prove it.
  constraint ad_video_readings_ready_is_complete check (
    status <> 'ready'
    or (jsonb_array_length(frames) > 0 and processed_at is not null
        and duration_ms is not null and processed_ms is not null and has_audio is not null)
  ),
  constraint ad_video_readings_audio_is_stored check (
    status <> 'ready' or has_audio = false
    or (audio_path is not null and audio_sha256 is not null
        and hook_audio_path is not null and hook_audio_sha256 is not null)
  ),
  -- A stopped row says why.
  constraint ad_video_readings_stop_has_reason check (
    status in ('pending', 'ready') or failure_reason is not null
  )
);

-- The worker's queue: the soonest link to die first, as the preview archive does.
create index ad_video_readings_pending_idx on public.ad_video_readings (source_expires_at)
  where status = 'pending';

comment on table public.ad_video_readings is
  'Frames and audio of a rival video ad observation, copied before the source link expires (spec 2026-11-23). Written only by the privileged video reader.';

alter table public.ad_video_readings enable row level security;

-- Reading follows media_assets: a signed-in account with a role row. Writes belong to the video
-- reader on the privileged connection, so there is deliberately no insert/update/delete policy.
create policy ad_video_readings_read on public.ad_video_readings
  for select to authenticated
  using (public.current_user_role() is not null);
grant select on table public.ad_video_readings to authenticated;

alter table public.ai_analyses drop constraint ai_analyses_kind_check;
alter table public.ai_analyses add constraint ai_analyses_kind_check
  check (kind in ('ad', 'set', 'transcript'));

drop function if exists public.ad_detail(text, uuid);

CREATE OR REPLACE FUNCTION public.ad_detail(p_ad_archive_id text, p_dataset_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(context text, ad_archive_id text, page_id text, page_profile_uri text, page_profile_numeric_id text, page_name text, page_like_count bigint, page_categories text[], start_date timestamp with time zone, end_date timestamp with time zone, first_seen_at timestamp with time zone, last_seen_at timestamp with time zone, ad_age_days integer, is_active boolean, display_format text, publisher_platform text[], cta_type text, cta_text text, title text, body_text text, caption text, link_url text, link_description text, collation_count integer, media jsonb, archive_path text, archive_status text, observed_at timestamp with time zone, collection_run_id uuid, ad_observation_id bigint)
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
    o.observed_at, o.collection_run_id, o.id
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

-- Recreating a function resets its ACL: the same posture as 0019 and 0024.
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

notify pgrst, 'reload schema';
