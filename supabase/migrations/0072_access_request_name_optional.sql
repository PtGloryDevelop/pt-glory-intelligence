-- The sign-up form asks only for email, password and team (0072): the name becomes optional, and the admin
-- list shows the email when there is none. The note column stays for rows that already carry one.
alter table public.access_requests alter column full_name drop not null;
alter table public.access_requests drop constraint access_requests_full_name_check;
alter table public.access_requests add constraint access_requests_full_name_check
  check (full_name is null or length(full_name) between 2 and 80);
notify pgrst,'reload schema';
