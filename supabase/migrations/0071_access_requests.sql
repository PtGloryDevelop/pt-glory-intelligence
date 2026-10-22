-- People ask for an account themselves; an admin approves or rejects it (0071).
-- Signing up creates the login unconfirmed, so it cannot sign in at all until an admin approves: approval
-- grants the role and confirms the login, rejection deletes the login so the email can be used again.
-- New rows are written only by the server's sign-up action; admins read and decide them through RLS.
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null check (email = lower(email) and length(email) between 3 and 254),
  full_name text not null check (length(full_name) between 2 and 80),
  team text check (team is null or length(team) <= 60),
  note text check (note is null or length(note) <= 300),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  role text check (role is null or role in ('viewer','analyst','admin')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null
);
create unique index access_requests_one_pending on public.access_requests (email) where status = 'pending';
create index access_requests_by_status on public.access_requests (status, created_at desc);

alter table public.access_requests enable row level security;
create policy access_requests_admin_read on public.access_requests for select to authenticated
  using (public.current_user_role() = 'admin');
create policy access_requests_admin_decide on public.access_requests for update to authenticated
  using (public.current_user_role() = 'admin' and status = 'pending')
  with check (public.current_user_role() = 'admin');

revoke all on public.access_requests from public, anon, authenticated;
grant select, update on public.access_requests to authenticated;
comment on table public.access_requests is 'Sign-up requests awaiting an admin; the login stays unconfirmed until approved (0071).';
notify pgrst,'reload schema';
