-- Read paths run through the anon key + user JWT, so these policies are the real
-- boundary there. The import path uses DATABASE_URL and BYPASSES all of this —
-- requireRole() in Node is the only guard on that side.

alter table public.user_roles        enable row level security;
alter table public.categories        enable row level security;
alter table public.collection_runs   enable row level security;
alter table public.datasets          enable row level security;
alter table public.pages             enable row level security;
alter table public.page_observations enable row level security;
alter table public.ads               enable row level security;
alter table public.ad_observations   enable row level security;
alter table public.dataset_ads       enable row level security;
alter table public.dataset_quality   enable row level security;
alter table public.import_quarantine enable row level security;
alter table public.app_settings      enable row level security;
alter table public.audit_logs        enable row level security;

-- user_roles: you may read your own row; only admins may read all or write any.
-- Nobody can change their own role, admins included, so a compromised admin
-- session cannot quietly escalate or lock the last admin out.
create policy user_roles_select_self on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.current_user_role() = 'admin');

create policy user_roles_admin_insert on public.user_roles
  for insert to authenticated
  with check (public.current_user_role() = 'admin' and user_id <> auth.uid());

create policy user_roles_admin_update on public.user_roles
  for update to authenticated
  using (public.current_user_role() = 'admin' and user_id <> auth.uid())
  with check (public.current_user_role() = 'admin' and user_id <> auth.uid());

create policy user_roles_admin_delete on public.user_roles
  for delete to authenticated
  using (public.current_user_role() = 'admin' and user_id <> auth.uid());

-- Business tables: everyone signed in reads; analyst and admin write.
do $$
declare t text;
begin
  foreach t in array array[
    'categories','collection_runs','datasets','pages','page_observations',
    'ads','ad_observations','dataset_ads','dataset_quality','import_quarantine'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated
        using (public.current_user_role() is not null);
      create policy %1$s_write on public.%1$s
        for insert to authenticated
        with check (public.current_user_role() in ('analyst','admin'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.current_user_role() in ('analyst','admin'))
        with check (public.current_user_role() in ('analyst','admin'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated
        using (public.current_user_role() = 'admin');
    $f$, t);
  end loop;
end $$;

-- Soft-deleted rows disappear from every read.
create policy categories_hide_deleted on public.categories
  for select to authenticated using (deleted_at is null);
create policy datasets_hide_deleted on public.datasets
  for select to authenticated using (deleted_at is null);

-- Admin-only surfaces.
create policy app_settings_read on public.app_settings
  for select to authenticated using (public.current_user_role() = 'admin');
create policy app_settings_write on public.app_settings
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy audit_logs_read on public.audit_logs
  for select to authenticated using (public.current_user_role() = 'admin');
