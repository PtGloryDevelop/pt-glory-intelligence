create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- Single place the evergreen rule reads from; never hard-code 90 in application code.
insert into public.app_settings (key, value) values
  ('evergreen_threshold_days', '90'::jsonb),
  ('count_mismatch_policy', '"reject"'::jsonb);
