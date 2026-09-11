-- 0036 — the API table grants, written down instead of inherited.
--
-- FOUND AT D1.2, the first regression against a current Supabase stack. The
-- migrations gave table privileges explicitly on 3 of the 17 product tables
-- (watch_items in 0032; brands and brand_page_mappings in 0033). The other 14
-- worked on the running Pilot only because that project was created while
-- Supabase still auto-granted every new public table to anon, authenticated and
-- service_role. Current Supabase does not. Built from these migrations alone, a
-- fresh project answered every authenticated read with 42501 permission denied:
-- 525/553 tests, every failure that one error.
--
-- What is granted is exactly what the RLS policies use, and nothing they do not:
--
--   authenticated  SELECT, INSERT, UPDATE, DELETE on the 15 tables whose
--                  policies cover all four commands; SELECT only on audit_logs
--                  and media_assets, whose only policy is SELECT.
--   anon           nothing. No policy has ever given anon a row.
--   service_role   only what code uses today (tests/db/auth-chain.test.ts):
--                  INSERT on user_roles; SELECT, INSERT, DELETE on categories.
--   jsonb_text_array(jsonb)
--                  EXECUTE to authenticated. 0031 took it away from PUBLIC and
--                  anon but left authenticated to the same legacy default.
--
-- RLS stays the row boundary. A table grant only lets a role reach a policy;
-- it never widens what the policy lets through.
--
-- APPLIED TO THE RUNNING PILOT THIS CHANGES NOTHING. The Pilot already holds
-- every privilege named here, plus legacy surplus that 0036 neither adds nor
-- takes away. It only ever adds.
--
-- ROLLBACK. Because the Pilot held these privileges before 0036 existed, a down
-- migration that simply withdrew them all would strip grants the Pilot had all
-- along and break it. So each privilege is checked against the object's own ACL
-- first: only one the grantee did NOT already hold directly is written to
-- migration_ledger.grants, and only then granted. The down migration withdraws
-- exactly the ledger's rows. On the Pilot the ledger is expected to stay empty.
--
-- The ledger lives in its own schema so no API role can reach it: PostgREST
-- exposes public, and every API role is shut out below.

create schema if not exists migration_ledger;
revoke all on schema migration_ledger from public;
revoke all on schema migration_ledger from anon, authenticated, service_role;

create table if not exists migration_ledger.grants (
  migration   text        not null,
  object_kind text        not null check (object_kind in ('table', 'function')),
  object_name text        not null,
  grantee     text        not null,
  privilege   text        not null,
  recorded_at timestamptz not null default now(),
  primary key (migration, object_kind, object_name, grantee, privilege)
);
revoke all on table migration_ledger.grants from public;
revoke all on table migration_ledger.grants from anon, authenticated, service_role;

do $$
declare
  g    record;
  held boolean;
begin
  for g in
    select * from (values
      -- authenticated: the four commands its policies cover.
      ('table', 'public.ad_observations',     'authenticated', 'SELECT'),
      ('table', 'public.ad_observations',     'authenticated', 'INSERT'),
      ('table', 'public.ad_observations',     'authenticated', 'UPDATE'),
      ('table', 'public.ad_observations',     'authenticated', 'DELETE'),
      ('table', 'public.ads',                 'authenticated', 'SELECT'),
      ('table', 'public.ads',                 'authenticated', 'INSERT'),
      ('table', 'public.ads',                 'authenticated', 'UPDATE'),
      ('table', 'public.ads',                 'authenticated', 'DELETE'),
      ('table', 'public.app_settings',        'authenticated', 'SELECT'),
      ('table', 'public.app_settings',        'authenticated', 'INSERT'),
      ('table', 'public.app_settings',        'authenticated', 'UPDATE'),
      ('table', 'public.app_settings',        'authenticated', 'DELETE'),
      ('table', 'public.brand_page_mappings', 'authenticated', 'SELECT'),
      ('table', 'public.brand_page_mappings', 'authenticated', 'INSERT'),
      ('table', 'public.brand_page_mappings', 'authenticated', 'UPDATE'),
      ('table', 'public.brand_page_mappings', 'authenticated', 'DELETE'),
      ('table', 'public.brands',              'authenticated', 'SELECT'),
      ('table', 'public.brands',              'authenticated', 'INSERT'),
      ('table', 'public.brands',              'authenticated', 'UPDATE'),
      ('table', 'public.brands',              'authenticated', 'DELETE'),
      ('table', 'public.categories',          'authenticated', 'SELECT'),
      ('table', 'public.categories',          'authenticated', 'INSERT'),
      ('table', 'public.categories',          'authenticated', 'UPDATE'),
      ('table', 'public.categories',          'authenticated', 'DELETE'),
      ('table', 'public.collection_runs',     'authenticated', 'SELECT'),
      ('table', 'public.collection_runs',     'authenticated', 'INSERT'),
      ('table', 'public.collection_runs',     'authenticated', 'UPDATE'),
      ('table', 'public.collection_runs',     'authenticated', 'DELETE'),
      ('table', 'public.dataset_ads',         'authenticated', 'SELECT'),
      ('table', 'public.dataset_ads',         'authenticated', 'INSERT'),
      ('table', 'public.dataset_ads',         'authenticated', 'UPDATE'),
      ('table', 'public.dataset_ads',         'authenticated', 'DELETE'),
      ('table', 'public.dataset_quality',     'authenticated', 'SELECT'),
      ('table', 'public.dataset_quality',     'authenticated', 'INSERT'),
      ('table', 'public.dataset_quality',     'authenticated', 'UPDATE'),
      ('table', 'public.dataset_quality',     'authenticated', 'DELETE'),
      ('table', 'public.datasets',            'authenticated', 'SELECT'),
      ('table', 'public.datasets',            'authenticated', 'INSERT'),
      ('table', 'public.datasets',            'authenticated', 'UPDATE'),
      ('table', 'public.datasets',            'authenticated', 'DELETE'),
      ('table', 'public.import_quarantine',   'authenticated', 'SELECT'),
      ('table', 'public.import_quarantine',   'authenticated', 'INSERT'),
      ('table', 'public.import_quarantine',   'authenticated', 'UPDATE'),
      ('table', 'public.import_quarantine',   'authenticated', 'DELETE'),
      ('table', 'public.page_observations',   'authenticated', 'SELECT'),
      ('table', 'public.page_observations',   'authenticated', 'INSERT'),
      ('table', 'public.page_observations',   'authenticated', 'UPDATE'),
      ('table', 'public.page_observations',   'authenticated', 'DELETE'),
      ('table', 'public.pages',               'authenticated', 'SELECT'),
      ('table', 'public.pages',               'authenticated', 'INSERT'),
      ('table', 'public.pages',               'authenticated', 'UPDATE'),
      ('table', 'public.pages',               'authenticated', 'DELETE'),
      ('table', 'public.user_roles',          'authenticated', 'SELECT'),
      ('table', 'public.user_roles',          'authenticated', 'INSERT'),
      ('table', 'public.user_roles',          'authenticated', 'UPDATE'),
      ('table', 'public.user_roles',          'authenticated', 'DELETE'),
      ('table', 'public.watch_items',         'authenticated', 'SELECT'),
      ('table', 'public.watch_items',         'authenticated', 'INSERT'),
      ('table', 'public.watch_items',         'authenticated', 'UPDATE'),
      ('table', 'public.watch_items',         'authenticated', 'DELETE'),
      -- authenticated: read-only tables, whose only policy is SELECT.
      ('table', 'public.audit_logs',          'authenticated', 'SELECT'),
      ('table', 'public.media_assets',        'authenticated', 'SELECT'),
      -- service_role: only what code uses today.
      ('table', 'public.user_roles',          'service_role',  'INSERT'),
      ('table', 'public.categories',          'service_role',  'SELECT'),
      ('table', 'public.categories',          'service_role',  'INSERT'),
      ('table', 'public.categories',          'service_role',  'DELETE'),
      -- the one function whose authenticated EXECUTE came from the old default.
      ('function', 'public.jsonb_text_array(jsonb)', 'authenticated', 'EXECUTE')
    ) as intended(kind, obj, grantee, priv)
  loop
    if g.kind = 'table' then
      select exists (
        select 1 from pg_class c, aclexplode(c.relacl) a
         where c.oid = g.obj::regclass
           and a.grantee = g.grantee::regrole
           and a.privilege_type = g.priv
      ) into held;
    else
      select exists (
        select 1 from pg_proc p, aclexplode(p.proacl) a
         where p.oid = g.obj::regprocedure
           and a.grantee = g.grantee::regrole
           and a.privilege_type = g.priv
      ) into held;
    end if;

    -- Held already (the Pilot, or a table 0032/0033 granted): nothing to add,
    -- nothing to record, nothing the rollback may ever take away.
    if not held then
      insert into migration_ledger.grants (migration, object_kind, object_name, grantee, privilege)
      values ('0036', g.kind, g.obj, g.grantee, g.priv)
      on conflict do nothing;
      execute format('grant %s on %s %s to %I', g.priv, g.kind, g.obj, g.grantee);
    end if;
  end loop;
end $$;
