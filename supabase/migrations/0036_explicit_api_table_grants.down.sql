-- Rolls 0036 back exactly.
--
-- Withdraws only the privileges 0036 itself added, as recorded in
-- migration_ledger.grants, and nothing an API role held before it. On the
-- running Pilot every privilege 0036 names was already held, so the ledger is
-- empty there and this changes nothing — by construction, not by assumption.
-- On a fresh install it returns the database to exactly its pre-0036 state.

do $$
declare
  g record;
begin
  if to_regclass('migration_ledger.grants') is null then
    raise notice '0036 down: no ledger present, nothing to withdraw';
    return;
  end if;

  for g in select * from migration_ledger.grants where migration = '0036' loop
    execute format('revoke %s on %s %s from %I', g.privilege, g.object_kind, g.object_name, g.grantee);
  end loop;

  delete from migration_ledger.grants where migration = '0036';

  -- The ledger goes with the last migration that used it.
  if not exists (select 1 from migration_ledger.grants) then
    drop table migration_ledger.grants;
    drop schema migration_ledger;
  end if;
end $$;
