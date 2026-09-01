create table public.audit_logs (
  id bigserial primary key,
  actor uuid references auth.users(id),
  action text not null,
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
