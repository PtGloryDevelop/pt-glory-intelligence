-- C08 follow-up: `provider_identity_conflict` joins the closed error_class list.
--
-- The state machine can meet a provider response that contradicts the identity
-- already persisted for a request: a different run id, dataset id, actor build,
-- or a different charge-bearing start instant. That is a real failure mode with
-- its own recovery — keep what is persisted, transition nothing, start nothing,
-- ask a person — and it now has its own name.
--
-- It is deliberately not folded into an existing class. `provider_start_unknown`
-- means we do not know whether a run exists; `provider_result_unsettled` means
-- the result never became readable. Both point an admin at recovery steps that
-- would be wrong here, where a run is known and its evidence disagrees with
-- itself.
--
-- Column-level grants, RLS and the safe view are unchanged: error_class stays
-- an admin diagnostic.

alter table public.collection_requests
  drop constraint collection_requests_error_class_check;

alter table public.collection_requests
  add constraint collection_requests_error_class_check
  check (error_class is null or error_class in (
    'provider_start_failed', 'provider_unreachable',
    -- An uncertain start an admin could not resolve safely. There is exactly
    -- one name for this state.
    'provider_start_unknown',
    -- Provider evidence that contradicts the identity already recorded.
    'provider_identity_conflict',
    'provider_run_failed', 'provider_timed_out', 'provider_aborted',
    -- The dataset never became ready inside the settlement window.
    'provider_result_unsettled',
    'adapter_rejected', 'export_too_large', 'import_failed'
  ));
