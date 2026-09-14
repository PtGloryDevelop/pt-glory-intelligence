-- Reverses 0040.
--
-- The column is scheduling state only: dropping it loses the record that an
-- admin reopened a cost window, and returns those requests to the automatic
-- window measured from the charge. No canonical data depends on it.

alter table public.collection_requests
  drop constraint collection_requests_result_reopen_needs_dataset,
  drop constraint collection_requests_cost_reopen_needs_run;

alter table public.collection_requests
  drop column result_settle_reopened_at,
  drop column cost_window_reopened_at;
