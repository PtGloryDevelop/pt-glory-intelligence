-- Reverses 0039.
--
-- The column is diagnostic and scheduling state, so dropping it loses only the
-- ability to finalize a provisional cost; no canonical data depends on it.

alter table public.collection_requests
  drop constraint collection_requests_provisional_observed;

alter table public.collection_requests
  drop column cost_provisional_observed_at;
