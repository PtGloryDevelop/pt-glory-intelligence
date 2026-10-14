-- schema_migrations is the migration runner's own ledger (scripts/migrate.mjs, which connects as the
-- database owner). It sat in public with RLS off and Supabase's default grants, so anyone holding the
-- public anon key could read it through the API, and could rewrite or empty it, after which the next
-- `migrate up` would try to apply every migration again. Nothing uses it through the API.
revoke all on public.schema_migrations from anon, authenticated;
-- No policies: API roles get nothing; the owner (the runner) is not subject to RLS.
alter table public.schema_migrations enable row level security;
