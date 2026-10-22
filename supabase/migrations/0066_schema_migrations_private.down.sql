-- Restores the state before 0066 (RLS off, API grants back). Only for rolling back; it reopens the ledger.
alter table public.schema_migrations disable row level security;
grant all on public.schema_migrations to anon, authenticated;
