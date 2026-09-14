-- C10: when the CURRENT provisional cost was first observed.
--
-- The frozen finalization rule is "two reads at least `cost_settle_minutes`
-- apart agree" (architecture review §3). Deciding that needs the instant the
-- amount now on the row was first seen — and that is not `cost_first_read_at`,
-- which is written once, at the first provider figure ever, and must keep that
-- meaning for admin diagnostics.
--
-- Without this column the rule cannot be evaluated after a provider figure
-- moves: C01-B read $0.0443 at the terminal moment and $0.0998 later, and the
-- clock that matters is the one that starts at $0.0998.
--
-- Diagnostics and scheduling only. It is never an amount, never an attribution
-- timestamp, and the budget arithmetic (C05) does not read it.

alter table public.collection_requests
  add column cost_provisional_observed_at timestamptz;

comment on column public.collection_requests.cost_provisional_observed_at is
  'When the current cost_provisional_usd was first observed. Reset whenever the provider figure changes; the provisional -> final rule measures from here.';

-- An observation instant without an amount, or an amount without the instant
-- that would let it settle, would both leave the rule unable to run.
alter table public.collection_requests
  add constraint collection_requests_provisional_observed
  check ((cost_provisional_usd is null) = (cost_provisional_observed_at is null));
