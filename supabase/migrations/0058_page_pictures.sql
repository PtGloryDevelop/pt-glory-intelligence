-- Competitor page profile pictures, kept in our own storage.
--
-- Facebook picture URLs expire within days, so the collector records the source URL and an archiver copies
-- the bytes into the private preview bucket. Written only by the privileged worker; readable by any role.

create table public.page_pictures (
  page_id text primary key references public.pages(page_id) on delete cascade,
  source_url text not null check (source_url ~ '^https://'),
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'archived', 'failed')),
  failure_reason text,
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now()
);
create index page_pictures_pending on public.page_pictures (updated_at) where status = 'pending';
comment on table public.page_pictures is 'Archived competitor page profile pictures (source URL from the collector, bytes in storage).';

alter table public.page_pictures enable row level security;
create policy page_pictures_read on public.page_pictures for select to authenticated using (public.current_user_role() is not null);
grant select on table public.page_pictures to authenticated;
notify pgrst, 'reload schema';
