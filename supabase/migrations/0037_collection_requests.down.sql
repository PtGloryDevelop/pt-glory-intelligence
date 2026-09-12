-- Reverses C04.
--
-- Refuses if any canonical run was already collected with apify_actor_run:
-- removing the method from the CHECK would leave real rows violating it, and a
-- down migration that corrupts data to look reversible is worse than none.
do $$
declare
  used int;
begin
  select count(*) into used
    from public.collection_runs where collection_method = 'apify_actor_run';
  if used > 0 then
    raise exception 'refusing to revert C04: % collection_runs already use apify_actor_run', used;
  end if;
end $$;

drop view if exists public.collection_request_status;
drop table if exists public.collection_requests;
drop index if exists public.collection_runs_request_once;

delete from public.app_settings where key like 'collector.%';

alter table public.collection_runs
  drop constraint collection_runs_collection_method_check;

alter table public.collection_runs
  add constraint collection_runs_collection_method_check
  check (collection_method in
    ('network_response_observation','user_initiated_dom_observation','socialapis_api'));
