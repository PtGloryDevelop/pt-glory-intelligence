-- Reverses 0038.
--
-- Refuses while any request is still classified as an identity conflict:
-- narrowing the CHECK would either leave rows violating it or require erasing
-- the reason a request is waiting for an admin. Resolve those requests first.
do $$
declare
  used int;
begin
  select count(*) into used
    from public.collection_requests where error_class = 'provider_identity_conflict';
  if used > 0 then
    raise exception 'refusing to revert 0038: % requests are classified provider_identity_conflict', used;
  end if;
end $$;

alter table public.collection_requests
  drop constraint collection_requests_error_class_check;

alter table public.collection_requests
  add constraint collection_requests_error_class_check
  check (error_class is null or error_class in (
    'provider_start_failed', 'provider_unreachable',
    'provider_start_unknown',
    'provider_run_failed', 'provider_timed_out', 'provider_aborted',
    'provider_result_unsettled',
    'adapter_rejected', 'export_too_large', 'import_failed'
  ));
