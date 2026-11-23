-- Puts back the holds 0079 cleared, from the amounts it recorded, and removes its audit rows.
-- Only rows still cleared are touched, so a later reservation is never overwritten.
update public.collection_requests r
   set cost_reserved_usd = (a.before->>'cost_reserved_usd')::numeric, updated_at = now()
  from public.audit_logs a
 where a.action = 'collection.refused_hold_cleared'
   and a.after->>'by' = 'migration 0079'
   and a.entity_id = r.id::text
   and r.cost_reserved_usd is null;

delete from public.audit_logs
 where action = 'collection.refused_hold_cleared'
   and after->>'by' = 'migration 0079';
