-- Row-level problems inside an otherwise valid file only.
-- File-level rejections (malformed_json, schema_mismatch, unknown_field,
-- unsupported_collection_method, size_limit_exceeded, count_mismatch) never reach
-- this table because nothing is committed for them.
create table public.import_quarantine (
  id uuid primary key default gen_random_uuid(),
  collection_run_id uuid not null references public.collection_runs(id) on delete cascade,
  reason text not null
    check (reason in ('missing_ad_archive_id','unresolved_source_record')),
  payload jsonb,
  created_at timestamptz not null default now()
);
