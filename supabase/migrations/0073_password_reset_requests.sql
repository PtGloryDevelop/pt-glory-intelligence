-- "Forgot password" requests (0073). The person leaves their email; an admin creates a one-time link to set a
-- new password and sends it to them directly. Only emails of approved accounts are stored, by the server.
-- Admins read and close them through RLS.
create table public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and length(email) between 3 and 254),
  status text not null default 'pending' check (status in ('pending','handled')),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references auth.users(id) on delete set null
);
create unique index password_reset_one_pending on public.password_reset_requests (email) where status = 'pending';

alter table public.password_reset_requests enable row level security;
create policy password_reset_admin_read on public.password_reset_requests for select to authenticated
  using (public.current_user_role() = 'admin');
create policy password_reset_admin_close on public.password_reset_requests for update to authenticated
  using (public.current_user_role() = 'admin' and status = 'pending')
  with check (public.current_user_role() = 'admin');

revoke all on public.password_reset_requests from public, anon, authenticated;
grant select, update on public.password_reset_requests to authenticated;
comment on table public.password_reset_requests is 'Forgot-password requests for approved accounts; an admin sends a one-time link (0073).';
notify pgrst,'reload schema';
