-- A start the provider refused (HTTP 401, or a request rejected before anything was sent) creates
-- no run and is charged nothing, yet its reservation stayed held for good: on 13 November 2026
-- three refused starts held USD 2.24535 and a USD 5 budget read as spent. The machine now clears
-- the hold at the refusal itself (lib/collect/machine.ts, releaseHold). This clears the ones from
-- before that, the same way: cost_reserved_usd null, which is what a queued request holds.
--
-- Data only, no schema change, safe with the code before and after the fix (a null reservation
-- has always counted as nothing held). Runs once in effect: a cleared row no longer matches.
-- Each row's amount is written to audit_logs first; the down migration restores from there.
with refused as (
  select id, cost_reserved_usd
    from public.collection_requests
   where status = 'failed'
     and error_class in ('provider_unreachable', 'provider_start_failed')
     and provider_run_id is null
     and started_at is null
     and cost_status = 'reserved'
     and reservation_released_at is null
     and cost_reserved_usd is not null
),
logged as (
  insert into public.audit_logs (actor, action, entity_type, entity_id, before, after)
  select null, 'collection.refused_hold_cleared', 'collection_request', id::text,
         jsonb_build_object('cost_reserved_usd', cost_reserved_usd),
         jsonb_build_object('cost_reserved_usd', null, 'released_hold_usd', cost_reserved_usd, 'by', 'migration 0079')
    from refused
  returning entity_id
)
update public.collection_requests r
   set cost_reserved_usd = null, updated_at = now()
  from refused
 where r.id = refused.id
   and refused.id::text in (select entity_id from logged);
