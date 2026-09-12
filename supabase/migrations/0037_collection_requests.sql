-- Phase 15 C04: the collection request ledger, and the rules the state machine
-- is not allowed to break.
--
-- WHAT THIS IS: one row per collection a person asks for, with every invariant
-- the machine depends on written as a constraint. The machine itself arrives in
-- later tickets; if it is ever wrong, the database still refuses.
--
-- WHAT THIS IS NOT: the collector. Nothing here calls a provider, starts a run
-- or schedules anything. collector.enabled is seeded false, and C16 is the only
-- gate that turns it on.
--
-- Three column groups, because they have three audiences: what the requester
-- may read, what an admin diagnoses with, and what only the server's own
-- recovery logic touches. The split is enforced by column grants and a
-- security_invoker view, not by what a screen happens to render.

-- ---------------------------------------------------------------------------
-- The automated method joins the enum.
--
-- Additive: the three historical methods stay exactly as they are, because the
-- Pilot's existing runs carry them and a rename would orphan real data.
alter table public.collection_runs
  drop constraint collection_runs_collection_method_check;

alter table public.collection_runs
  add constraint collection_runs_collection_method_check
  check (collection_method in (
    'network_response_observation',
    'user_initiated_dom_observation',
    'socialapis_api',
    -- Collected by an automated Ad Library search the server started.
    'apify_actor_run'
  ));

-- ---------------------------------------------------------------------------
-- Exactly-once canonical commit, decided by the database.
--
-- The adapter writes the request's own UUID into the export's quality_summary,
-- which the unchanged import engine stores here. A second commit of the same
-- request violates this index inside commitImport's own transaction and rolls
-- the whole thing back. The engine contract does not change.
create unique index collection_runs_request_once
  on public.collection_runs ((reported_quality_summary ->> 'collection_request_id'))
  where reported_quality_summary ->> 'collection_request_id' is not null;

-- ---------------------------------------------------------------------------
create table public.collection_requests (
  -- ---------------------------------------------------------------- user-safe
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete cascade,
  -- Idempotency for the submit button: the form generates this once, so a
  -- double click cannot buy two collections.
  request_key text not null,

  status text not null default 'queued' check (status in (
    'queued', 'starting', 'provider_start_uncertain', 'running',
    -- A terminal provider run is not yet a complete result: the dataset is
    -- observed twice before anything is imported (architecture review section 9).
    'settling',
    'importing', 'succeeded', 'failed'
  )),
  -- True when the request is waiting for a person. The requester's own status
  -- line has to say so, which is why this is readable by the requester; it
  -- carries no provider detail.
  requires_admin boolean not null default false,

  -- What was asked for: keyword, country, active_status, max_records.
  params jsonb not null,
  category_id uuid not null references public.categories(id),
  dataset_name text,
  -- The Ad Library search URL the server built. Ours, not a provider's.
  source_url text,
  -- A neutral count of what the collection returned. Never a provider name.
  provider_item_count int check (provider_item_count is null or provider_item_count >= 0),
  -- Counts only, the same ones the import engine already reports.
  result jsonb,
  stop_reason text,
  collection_run_id uuid references public.collection_runs(id),
  dataset_id uuid references public.datasets(id),

  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),

  -- -------------------------------------------------------- admin diagnostics
  provider text,
  provider_actor text,
  provider_actor_build text,
  provider_run_id text,
  provider_dataset_id text,
  -- The classes the spec (section 15) and the architecture review name. A
  -- closed list, so a class nobody documented cannot appear in an admin screen.
  error_class text check (error_class is null or error_class in (
    'provider_start_failed', 'provider_unreachable',
    -- An uncertain start an admin could not resolve safely. There is exactly
    -- one name for this state.
    'provider_start_unknown',
    'provider_run_failed', 'provider_timed_out', 'provider_aborted',
    -- The dataset never became ready inside the settlement window.
    'provider_result_unsettled',
    'adapter_rejected', 'export_too_large', 'import_failed'
  )),
  -- Scrubbed, and bounded so a provider error body cannot become a log dump.
  error_detail text check (error_detail is null or length(error_detail) <= 2000),
  retry_count int not null default 0 check (retry_count >= 0),

  -- Cost has its own lifecycle, separate from the request's status.
  cost_status text not null default 'reserved'
    check (cost_status in ('reserved', 'provisional', 'final', 'unreported')),
  cost_reserved_usd numeric(12, 6) check (cost_reserved_usd is null or cost_reserved_usd >= 0),
  cost_provisional_usd numeric(12, 6) check (cost_provisional_usd is null or cost_provisional_usd >= 0),
  cost_final_usd numeric(12, 6) check (cost_final_usd is null or cost_final_usd >= 0),
  cost_first_read_at timestamptz,
  cost_finalized_at timestamptz,
  -- The provider ceiling stopped the run. Visible to admins, and never
  -- conflated with a stop_reason the product reports.
  ceiling_reached boolean not null default false,
  -- Cost reconciliation's own schedule, independent of next_check_at below: the
  -- cost of a terminal run keeps settling while the request itself waits.
  cost_next_check_at timestamptz,

  -- The audited release of a reservation nobody can resolve (C11). Recorded
  -- here; the action itself is not in this migration.
  reservation_released_at timestamptz,
  reservation_released_by uuid references auth.users(id),
  reservation_release_reason text,

  -- Settlement observations. Diagnostics: they say what the provider reported
  -- at a moment, and they are never canonical counts.
  result_item_count int check (result_item_count is null or result_item_count >= 0),
  result_modified_at timestamptz,
  result_pagination_total int check (result_pagination_total is null or result_pagination_total >= 0),
  result_observed_at timestamptz,
  result_settle_started_at timestamptz,
  -- Billing evidence and a consistency check only. Never required to equal
  -- result_item_count.
  result_charged_items int check (result_charged_items is null or result_charged_items >= 0),

  -- -------------------------------------------------------- internal recovery
  lease_owner text,
  lease_expires_at timestamptz,
  attempt int not null default 0 check (attempt >= 0),
  next_check_at timestamptz,
  -- Committed before the provider call, so a lost response can never become a
  -- second paid run.
  start_attempted_at timestamptz,
  import_attempted_at timestamptz,
  media_enqueued_at timestamptz,

  -- One request per submission.
  constraint collection_requests_request_key_unique unique (requested_by, request_key),
  -- One provider run per request, never shared.
  constraint collection_requests_provider_run_unique unique (provider_run_id),
  -- One committed canonical run per request.
  constraint collection_requests_collection_run_unique unique (collection_run_id),

  -- A queued request has not been attempted yet.
  constraint collection_requests_queued_untouched
    check (status <> 'queued' or start_attempted_at is null),
  -- These states all mean a provider run exists and has been identified.
  constraint collection_requests_run_identified
    check (status not in ('running', 'settling', 'importing') or provider_run_id is not null),
  -- A terminal request has a finish time.
  constraint collection_requests_terminal_finished
    check (status not in ('succeeded', 'failed') or finished_at is not null),

  -- Cost reconciliation reads a run. With no run identified there is nothing to
  -- poll, and guessing one is exactly what must never happen.
  constraint collection_requests_cost_check_needs_run
    check (cost_next_check_at is null or provider_run_id is not null),

  -- The release is all three fields or none, with a real reason, and only for
  -- the unresolved case: no identified run, and a cost nobody could report.
  -- Releasing changes the held reservation only, so cost_status stays
  -- unreported.
  constraint collection_requests_reservation_release
    check (
      (reservation_released_at is null
        and reservation_released_by is null
        and reservation_release_reason is null)
      or (reservation_released_at is not null
        and reservation_released_by is not null
        and reservation_release_reason is not null
        and reservation_release_reason ~ '[^[:space:]]'
        and provider_run_id is null
        and cost_status = 'unreported')
    )
);

comment on table public.collection_requests is
  'One collection a person asked for, with the state machine invariants enforced as constraints. Provider detail is admin-only; the requester reads collection_request_status.';

-- Work due: the sweep claims by state and time.
create index collection_requests_due_idx on public.collection_requests (status, next_check_at);
-- The requester's own list.
create index collection_requests_owner_idx on public.collection_requests (requested_by, created_at desc);
-- Cost reconciliation is its own sweep, so it gets its own index rather than
-- sharing the state one.
create index collection_requests_cost_due_idx
  on public.collection_requests (cost_status, cost_next_check_at)
  where cost_next_check_at is not null;

-- ---------------------------------------------------------------------------
-- Access.
--
-- RLS: a requester reads their own rows. There is no insert, update or delete
-- policy at all, because every write goes through the server's privileged path
-- after a role check, and a table grant must never become a way around a
-- missing policy.
alter table public.collection_requests enable row level security;

create policy collection_requests_select_own on public.collection_requests
  for select to authenticated
  using (requested_by = auth.uid());

revoke all on table public.collection_requests from public;
revoke all on table public.collection_requests from anon;

-- Column-level, not table-level: the admin and recovery groups are not readable
-- by the API roles at all, so adding a column to this table never quietly
-- publishes it.
grant select (
  id, requested_by, request_key, status, requires_admin, params, category_id,
  dataset_name, source_url, provider_item_count, result, stop_reason,
  collection_run_id, dataset_id, created_at, started_at, finished_at, updated_at
) on table public.collection_requests to authenticated;

-- The only thing the non-admin read path queries. security_invoker, so the
-- caller's own RLS and column grants still decide what comes back.
create view public.collection_request_status
  with (security_invoker = true) as
  select id, requested_by, request_key, status, requires_admin, params,
         category_id, dataset_name, source_url, provider_item_count, result,
         stop_reason, collection_run_id, dataset_id,
         created_at, started_at, finished_at, updated_at
    from public.collection_requests;

comment on view public.collection_request_status is
  'User-safe projection of collection_requests. No provider identity, no run id, no cost.';

revoke all on public.collection_request_status from public;
revoke all on public.collection_request_status from anon;
grant select on public.collection_request_status to authenticated;

-- ---------------------------------------------------------------------------
-- Settings. Every price, budget and window is configurable and starts unset:
-- one qualification run is evidence, not a production default.
insert into public.app_settings (key, value) values
  -- Budget and ceilings, TBD until the owner sets them.
  ('collector.monthly_budget_usd', 'null'::jsonb),
  ('collector.max_charge_per_run_usd', 'null'::jsonb),
  ('collector.estimated_usd_per_1000_ads', 'null'::jsonb),
  -- The billing window is an anchor plus a length, never a calendar month.
  ('collector.billing_cycle_anchor', 'null'::jsonb),
  ('collector.billing_cycle_length_months', 'null'::jsonb),
  -- Per-run limits. max_export_bytes must be set at or below MAX_BYTES (25 MB),
  -- which stays the authoritative ceiling in lib/collector/contract.ts.
  ('collector.max_records_per_run', 'null'::jsonb),
  ('collector.max_export_bytes', 'null'::jsonb),
  ('collector.run_timeout_minutes', 'null'::jsonb),
  -- Reconciliation of an uncertain start.
  ('collector.reconcile_window_minutes', 'null'::jsonb),
  ('collector.reconcile_page_size', 'null'::jsonb),
  -- Cost settlement: how far apart two agreeing reads must be, and how long the
  -- window stays open. Engineering parameters, calibrated on real runs.
  ('collector.cost_settle_minutes', 'null'::jsonb),
  ('collector.cost_final_window_hours', 'null'::jsonb),
  -- Provider-result settlement: the gap between two dataset observations, and
  -- the bounded window before an admin is asked. Not set from one run.
  ('collector.result_settle_seconds', 'null'::jsonb),
  ('collector.result_settle_window_minutes', 'null'::jsonb),
  -- How many requests one scheduled tick claims.
  ('collector.tick_batch', 'null'::jsonb),
  ('collector.actor_build', 'null'::jsonb),
  -- Values the design does fix.
  ('collector.max_concurrent', '1'::jsonb),
  ('collector.lease_seconds', '120'::jsonb),
  ('collector.actor', '"curious_coder/facebook-ads-library-scraper"'::jsonb),
  ('collector.countries', '["TH"]'::jsonb),
  -- Fail closed. C16 is the only gate that flips this.
  ('collector.enabled', 'false'::jsonb);
