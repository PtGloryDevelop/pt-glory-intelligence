-- UI v2 phase 5: cached AI reads of ads and of comparison sets.
--
-- One row per (model, ad, ad copy) or per (model, set of ad analyses). A cached row is reused, so the same
-- ad is never paid for twice. usd is the provider's reported token usage priced at the time of the call;
-- the API route sums it to enforce the daily and total caps. Results are AI readings, not source data.

create table public.ai_analyses (
  key text primary key check (length(key) between 8 and 300),
  kind text not null check (kind in ('ad', 'set')),
  model text not null check (length(model) between 1 and 80),
  result jsonb not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  usd numeric(10, 6) not null default 0 check (usd >= 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ai_analyses_created_at on public.ai_analyses (created_at);
comment on table public.ai_analyses is 'Cached AI readings of ads (kind=ad) and comparison sets (kind=set), with the cost of each call.';

alter table public.ai_analyses enable row level security;
create policy ai_analyses_read on public.ai_analyses for select to authenticated using (public.current_user_role() in ('analyst','admin'));
create policy ai_analyses_insert on public.ai_analyses for insert to authenticated with check (public.current_user_role() in ('analyst','admin'));
create policy ai_analyses_update on public.ai_analyses for update to authenticated
  using (public.current_user_role() in ('analyst','admin')) with check (public.current_user_role() in ('analyst','admin'));
grant select, insert, update on table public.ai_analyses to authenticated;
notify pgrst, 'reload schema';
