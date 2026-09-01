create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer','analyst','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Single source of truth for every RLS policy. security definer so that policies on
-- other tables can read user_roles without granting users direct read access to it.
create function public.current_user_role() returns text
  language sql stable security definer set search_path = public as $$
    select role from public.user_roles where user_id = auth.uid()
  $$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;
