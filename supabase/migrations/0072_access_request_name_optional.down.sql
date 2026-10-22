-- Makes the name required again. Rows without one get their email as the name first, so the rollback cannot fail on them.
update public.access_requests set full_name = left(email, 80) where full_name is null;
alter table public.access_requests drop constraint access_requests_full_name_check;
alter table public.access_requests add constraint access_requests_full_name_check check (length(full_name) between 2 and 80);
alter table public.access_requests alter column full_name set not null;
notify pgrst,'reload schema';
