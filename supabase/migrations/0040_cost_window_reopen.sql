-- C11: admin retries reopen spent settlement and cost-reconciliation windows.
--
-- C10's automatic window is measured from the charge (`started_at`, or the
-- recorded start attempt) and is therefore permanently spent once it passes.
-- The architecture review gives an admin a read-only **Retry cost
-- reconciliation** for exactly that case, and reopening a window nobody can
-- move needs somewhere to record that it was reopened.
--
-- Set only by that audited admin action. No automatic path writes it, and it is
-- a polling deadline only: billing-cycle attribution stays `started_at` alone
-- (C05), which fails closed without one.

alter table public.collection_requests
  add column result_settle_reopened_at timestamptz,
  add column cost_window_reopened_at timestamptz;

comment on column public.collection_requests.result_settle_reopened_at is
  'When an admin last reopened the provider-result settlement window (C11). Scheduling only: preserves result_settle_started_at history and never starts a provider run.';

comment on column public.collection_requests.cost_window_reopened_at is
  'When an admin last reopened the automatic cost-reconciliation window (C11). Scheduling only: never an attribution timestamp, never written by an automatic path.';

-- Reopening the window means asking about a run. With no run identified there
-- is nothing to ask, which is the same rule cost_next_check_at already follows.
alter table public.collection_requests
  add constraint collection_requests_result_reopen_needs_dataset
  check (result_settle_reopened_at is null or provider_dataset_id is not null),
  add constraint collection_requests_cost_reopen_needs_run
  check (cost_window_reopened_at is null or provider_run_id is not null);
