-- Compare rounds (team feedback, 31 Oct): the ad team talks to AI about a compared pair, and each round is
-- kept: the ads, the AI summary as it was then, every question and answer, and the team's own note.
--
-- A round starts when someone asks a first question or writes a note, not when a pair is merely opened
-- (the comparison reads itself on open). Rounds are the team's shared record: analysts and admins read
-- them all. Answers are AI interpretation: each keeps the indexes of the ads it cites, and its cost.

create table public.compare_rounds (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  view text not null check (view in ('general', 'ads')),
  -- [{ref, side: 'own'|'rival', label, facts}] in the order the AI was shown them (index = evidence number).
  ads jsonb not null check (jsonb_typeof(ads) = 'array' and jsonb_array_length(ads) between 2 and 5),
  ad_key text not null check (length(ad_key) between 8 and 600),
  unit_name text check (unit_name is null or length(unit_name) between 1 and 120),
  -- The comparison summary the round was based on, as AI gave it at the time.
  summary jsonb not null,
  title text check (title is null or length(title) between 1 and 200),
  note_seen text check (note_seen is null or length(note_seen) <= 2000),
  note_next jsonb check (note_next is null or (jsonb_typeof(note_next) = 'array' and jsonb_array_length(note_next) <= 10)),
  noted_at timestamptz,
  noted_by uuid references auth.users(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text check (created_by_name is null or length(created_by_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index compare_rounds_created_at on public.compare_rounds (created_at desc);
create index compare_rounds_ad_key on public.compare_rounds (ad_key, created_at desc);
comment on table public.compare_rounds is 'One talk with AI about a compared set of ads: the ads, the summary then, and the team''s note. AI interpretation, not source data.';

create table public.compare_messages (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.compare_rounds(id) on delete cascade,
  -- note = an AI draft of the round's note (kept for its cost; not shown in the talk).
  role text not null check (role in ('user', 'assistant', 'note')),
  content text not null check (length(content) between 1 and 6000),
  -- Evidence: indexes into the round's ads that an answer cites.
  ads smallint[] not null default '{}',
  model text check (model is null or length(model) between 1 and 80),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  usd numeric(10, 6) not null default 0 check (usd >= 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index compare_messages_round on public.compare_messages (round_id, created_at);
create index compare_messages_created_at on public.compare_messages (created_at);
comment on table public.compare_messages is 'Questions and AI answers in a compare round, with each answer''s cited ads and cost.';

alter table public.compare_rounds enable row level security;
alter table public.compare_messages enable row level security;
create policy compare_rounds_read on public.compare_rounds for select to authenticated using (public.current_user_role() in ('analyst', 'admin'));
create policy compare_rounds_insert on public.compare_rounds for insert to authenticated with check (public.current_user_role() in ('analyst', 'admin'));
create policy compare_rounds_update on public.compare_rounds for update to authenticated
  using (public.current_user_role() in ('analyst', 'admin')) with check (public.current_user_role() in ('analyst', 'admin'));
create policy compare_messages_read on public.compare_messages for select to authenticated using (public.current_user_role() in ('analyst', 'admin'));
create policy compare_messages_insert on public.compare_messages for insert to authenticated with check (public.current_user_role() in ('analyst', 'admin'));
revoke all on table public.compare_rounds, public.compare_messages from public, anon;
grant select, insert, update on table public.compare_rounds to authenticated;
grant select, insert on table public.compare_messages to authenticated;
notify pgrst, 'reload schema';
