-- Durable media archive — Phase 1: one preview per ad observation.
--
-- The problem this exists for, measured in docs/MEDIA_DURABILITY_AUDIT.md: every
-- media URL the collector stores is a signed URL with a median lifetime of about
-- 105 hours. Four days after a collection the dataset still has all its metadata
-- and none of its creatives. This table is the state machine for copying one
-- still per observation into storage we control, before that window closes.
--
-- Two rules the design turns on:
--
--   1. `ad_observations.media` is source truth and is NEVER rewritten. This is a
--      separate layer that references it. A row here is our record of what we
--      did with a source URL, not a replacement for the source URL.
--
--   2. Ownership is the OBSERVATION, not the ad. Keying archives by
--      ad_archive_id would let a newer collection run overwrite the creative an
--      older dataset shows — invariant I1 broken through the media layer instead
--      of through the observation layer.

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),

  -- The historical observation this preview belongs to. Cascade: an observation
  -- that goes away takes its archive state with it.
  ad_observation_id bigint not null
    references public.ad_observations(id) on delete cascade,

  -- Room for later roles (full video, original still) without a second table.
  -- Phase 1 writes only 'preview'.
  asset_role text not null default 'preview'
    check (asset_role in ('preview')),

  -- What the ad IS, kept apart from what the archived file is. A VIDEO ad whose
  -- durable preview is a JPEG poster stays a VIDEO ad; conflating the two is the
  -- semantic bug C1 surfaced.
  source_media_kind text
    check (source_media_kind in ('image', 'video', 'carousel')),

  -- Which collector field the candidate came from, so a later contract change is
  -- traceable rather than mysterious.
  source_field text,
  source_url text,

  -- Parsed from the signed URL's `oe` parameter. Scheduling metadata that we
  -- derived — not canonical Meta business data.
  source_expires_at timestamptz,
  source_host text,

  --  pending   a candidate exists and has not been archived yet
  --  archived  bytes are in our storage
  --  none      the observation genuinely carries no media entries
  --  unusable  entries exist but the preview policy cannot pick a candidate
  --  failed    a candidate existed and archival did not succeed
  --
  -- `none` and `unusable` are different facts and must never be merged: saying
  -- "no media" about an ad that has media is the class of untruth this project
  -- exists to avoid.
  archive_status text not null default 'pending'
    check (archive_status in ('pending', 'archived', 'none', 'unusable', 'failed')),

  -- Path inside the private bucket. The durable thing is the object; a signed
  -- delivery URL is generated on demand and is allowed to expire.
  storage_path text,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),

  -- Recorded from the start so content-addressed dedup can be switched on later
  -- without re-downloading anything. No dedup in this phase.
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),

  attempt_count int not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  archived_at timestamptz,

  -- Machine-readable classification only. Never a URL, never a query string.
  failure_reason text,

  created_at timestamptz not null default now(),
  -- Set by the writer, matching how every other table here handles it.
  updated_at timestamptz not null default now(),

  -- One archive row per observation per role. This is what makes the processor
  -- safe to run repeatedly: enqueue is an upsert against this constraint.
  unique (ad_observation_id, asset_role),

  -- A row claiming to be archived must be able to prove it.
  constraint media_assets_archived_has_object check (
    archive_status <> 'archived'
    or (storage_path is not null and byte_size is not null and sha256 is not null)
  )
);

-- The queue, ordered the way the processor drains it. Sources do not expire on a
-- uniform schedule — the fresh measurement found one with 28 hours left against a
-- median of 102 — so the soonest to die is always taken first.
create index media_assets_queue_idx
  on public.media_assets (source_expires_at asc nulls last)
  where archive_status in ('pending', 'failed');

create index media_assets_observation_idx on public.media_assets (ad_observation_id);
create index media_assets_status_idx on public.media_assets (archive_status);

alter table public.media_assets enable row level security;

-- Reading follows the same rule as every other business table: a signed-in
-- account with a role row. Writes belong to the archival path, which runs on the
-- privileged connection and bypasses RLS entirely — so there is deliberately no
-- insert/update/delete policy here. An authenticated session cannot forge an
-- archive row or repoint one at another object.
create policy media_assets_read on public.media_assets
  for select to authenticated
  using (public.current_user_role() is not null);
