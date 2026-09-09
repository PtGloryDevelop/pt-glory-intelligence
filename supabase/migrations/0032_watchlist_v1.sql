-- Watchlist V1 (P2.7): saved research targets and a manual baseline.
--
-- WHAT THIS IS: a place to keep the pages and categories a researcher cares
-- about, with an explicit data scope, a set of deterministic signals, and one
-- timestamp — `baseline_at` — that answers "since when?".
--
-- WHAT THIS IS NOT: monitoring. There is no evaluator, no schedule, no event
-- history, no notification. Nothing in this file runs on its own. Every number
-- a watch shows is computed live, from the frozen P2.1–P2.5 primitives, at the
-- moment somebody opens it. Automatic monitoring stays blocked on C1.9, and the
-- absence of an events table here is deliberate: storing "alerts" nothing
-- generates would be a promise the product cannot keep.
--
-- The baseline moves only when a person says so. Opening a watch never advances
-- it — a screen that quietly marked itself read would destroy the one thing the
-- feature is for.

-- ---------------------------------------------------------------------------
-- The saved target.
--
-- Identity is stored as identity: pages.page_id and categories.id, never a
-- display name. Names come from observations and change between runs; the
-- product already keeps the history that proves it.
create table public.watch_items (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,

  -- Page or Category. A Page is not a Brand, and there is no brand target.
  target_type text not null check (target_type in ('page', 'category')),
  target_page_id text references public.pages(page_id) on delete cascade,
  target_category_id uuid references public.categories(id) on delete cascade,

  -- The data the watch is about, always explicit. Watching a page inside one
  -- category is a different question from watching it across everything, and
  -- the answer differs, so the scope is part of the item rather than of
  -- wherever the user happened to be standing.
  scope_kind text not null check (scope_kind in ('dataset', 'category', 'all')),
  scope_dataset_id uuid references public.datasets(id) on delete cascade,
  scope_category_id uuid references public.categories(id) on delete cascade,

  -- An allowlist, checked here as well as in TypeScript: an unknown signal
  -- would otherwise reach a query that silently returns nothing.
  tracked_signals text[] not null
    check (cardinality(tracked_signals) > 0)
    check (tracked_signals <@ array[
      'PAGE_NEWLY_FOUND_AD', 'PAGE_STARTED_AD', 'PAGE_STATUS_OBSERVED_CHANGE',
      'PAGE_NEW_FORMAT_OBSERVED', 'PAGE_NEW_CTA_OBSERVED', 'PAGE_REUSE_CHANGED',
      'CATEGORY_NEWLY_FOUND_AD'
    ]),

  -- "Since when". Server time only; a client clock must never decide what
  -- counts as new.
  baseline_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Polymorphism enforced in the database, not only in the application: a row
  -- that names both a page and a category answers no question at all.
  constraint watch_target_shape check (
    (target_type = 'page'
       and target_page_id is not null and target_category_id is null)
    or (target_type = 'category'
       and target_category_id is not null and target_page_id is null)
  ),
  constraint watch_scope_shape check (
    (scope_kind = 'dataset'
       and scope_dataset_id is not null and scope_category_id is null)
    or (scope_kind = 'category'
       and scope_category_id is not null and scope_dataset_id is null)
    or (scope_kind = 'all'
       and scope_dataset_id is null and scope_category_id is null)
  ),
  -- A category watch is always about its own category. The scope column stays
  -- populated anyway so one contract serves both target types.
  constraint watch_category_scope_matches_target check (
    target_type <> 'category'
    or (scope_kind = 'category' and scope_category_id = target_category_id)
  ),
  -- Category signals belong to category targets and page signals to page ones.
  constraint watch_signals_match_target check (
    case target_type
      when 'page' then not ('CATEGORY_NEWLY_FOUND_AD' = any (tracked_signals))
      else tracked_signals <@ array['CATEGORY_NEWLY_FOUND_AD']
    end
  )
);

-- One watch per person, target and scope. NULLS NOT DISTINCT is what makes this
-- work: without it two identical page watches would both be unique, because
-- their null category columns would count as different.
create unique index watch_items_unique
  on public.watch_items (created_by, target_type, target_page_id, target_category_id,
                         scope_kind, scope_dataset_id, scope_category_id)
  nulls not distinct;

create index watch_items_owner_idx on public.watch_items (created_by, created_at desc);

comment on table public.watch_items is
  'Saved research targets with a manual baseline. Not monitoring: nothing evaluates these on a schedule.';

-- ---------------------------------------------------------------------------
-- Ownership.
--
-- A watchlist is personal research state, so the row's owner is the only reader
-- and the only writer. This is deliberately NOT the analyst/admin write rule the
-- data tables use: those protect canonical imported data, and this protects
-- nobody but the person who saved it. A viewer may keep their own list and can
-- still change no dataset, ad or observation.
alter table public.watch_items enable row level security;

create policy watch_items_select_own on public.watch_items
  for select to authenticated
  using (created_by = auth.uid());

create policy watch_items_insert_own on public.watch_items
  for insert to authenticated
  -- created_by cannot be forged: the check compares it to the caller's own id.
  with check (created_by = auth.uid() and public.current_user_role() is not null);

create policy watch_items_update_own on public.watch_items
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy watch_items_delete_own on public.watch_items
  for delete to authenticated
  using (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- The ads one watch is about.
--
-- Resolves a stored item to its scope and target, then hands back ad references
-- from the frozen membership primitive. Everything else in this file builds on
-- it, so "which ads" has one definition per watch.
create function public.watch_scope_ads(p_watch_id uuid)
returns table (ad_ref uuid)
language sql stable as $$
  with item as (
    select * from public.watch_items where id = p_watch_id
  )
  select s.ad_ref
    from item i
    cross join lateral public.page_scope_ads(
      i.scope_kind,
      case i.scope_kind when 'dataset' then i.scope_dataset_id
                        when 'category' then i.scope_category_id end
    ) s
    join public.ads a on a.id = s.ad_ref
    join public.pages p on p.id = a.page_ref
   where i.target_type = 'category' or p.page_id = i.target_page_id
$$;

-- ---------------------------------------------------------------------------
-- What each tracked signal currently says.
--
-- `value` is the count the UI shows. `new_observations` is the number of ads
-- whose newest observation is newer than the one that existed at the baseline —
-- it is what separates "nothing changed" from "we have not collected since",
-- which are different answers and must never be rendered as the same one.
create function public.watchlist_signal_summary(p_watch_id uuid)
returns table (
  signal text,
  kind text,
  -- Always the count the evidence query returns for this signal. Anything else
  -- would make the drill-down disagree with the number that invited it.
  value bigint,
  -- The values first observed after the baseline, for the first_observed
  -- signals. Null elsewhere.
  new_values text[],
  -- Ads whose newest observation is newer than the one that existed at the
  -- baseline. Zero means "we have not collected since", which is a different
  -- answer from "nothing changed".
  new_observations bigint,
  baseline_at timestamptz
)
language sql stable as $$
  with item as (
    select w.*,
           case w.scope_kind when 'dataset' then w.scope_dataset_id
                             when 'category' then w.scope_category_id end as scope_id
      from public.watch_items w where w.id = p_watch_id
  ), ads_watched as (
    select s.ad_ref from public.watch_scope_ads(p_watch_id) s
  ), events as (
    select a.id as ad_ref, a.first_seen_at, a.start_date
      from ads_watched w
      join public.ads a on a.id = w.ad_ref
  ), baseline_state as (
    -- The scope as it stood at the baseline instant, using the frozen P2.5
    -- reconstruction rather than a second definition of "as of".
    select t.ad_ref, t.observation_id
      from item i
      cross join lateral public.trend_state_scope(i.scope_kind, i.scope_id, i.baseline_at) t
      join ads_watched w on w.ad_ref = t.ad_ref
  ), current_state as (
    select s.ad_ref, s.observation_id
      from item i
      cross join lateral public.page_scope_observations(i.scope_kind, i.scope_id) s
      join ads_watched w on w.ad_ref = s.ad_ref
  ), paired as (
    select c.ad_ref, c.observation_id as current_id, b.observation_id as baseline_id,
           co.is_active as current_active, bo.is_active as baseline_active,
           co.display_format as current_format,
           co.cta_type as current_cta,
           co.collation_count as current_collation, bo.collation_count as baseline_collation
      from current_state c
      left join baseline_state b on b.ad_ref = c.ad_ref
      join public.ad_observations co on co.id = c.observation_id
      left join public.ad_observations bo on bo.id = b.observation_id
  ), fresh as (
    -- An ad we have looked at again since the baseline.
    select count(*) as n from paired
     where baseline_id is null or current_id <> baseline_id
  ), before_baseline as (
    -- Everything observed in scope BEFORE the baseline, used to decide whether
    -- a value is genuinely new rather than merely present.
    select o.display_format, o.cta_type
      from item i
      join public.datasets d
        on d.deleted_at is null
       and (i.scope_kind = 'all'
            or (i.scope_kind = 'dataset'  and d.id = i.scope_id)
            or (i.scope_kind = 'category' and d.category_id = i.scope_id))
      join public.collection_runs cr on cr.id = d.collection_run_id and cr.collected_at < i.baseline_at
      join public.ad_observations o on o.collection_run_id = cr.id
      join ads_watched w on w.ad_ref = o.ad_ref
  )
  select 'PAGE_NEWLY_FOUND_AD', 'event',
         (select count(*) from events e, item i
           where e.first_seen_at >= i.baseline_at and e.first_seen_at < now()),
         null::text[], (select n from fresh), (select baseline_at from item)
    from item where target_type = 'page'
  union all
  select 'CATEGORY_NEWLY_FOUND_AD', 'event',
         (select count(*) from events e, item i
           where e.first_seen_at >= i.baseline_at and e.first_seen_at < now()),
         null::text[], (select n from fresh), (select baseline_at from item)
    from item where target_type = 'category'
  union all
  select 'PAGE_STARTED_AD', 'event',
         (select count(*) from events e, item i
           where e.start_date >= i.baseline_at and e.start_date < now()),
         null::text[], (select n from fresh), (select baseline_at from item)
    from item where target_type = 'page'
  union all
  -- States: only ads we have actually re-observed can have changed.
  select 'PAGE_STATUS_OBSERVED_CHANGE', 'state',
         (select count(*) from paired
           where baseline_id is not null and current_id <> baseline_id
             and current_active is distinct from baseline_active),
         null::text[], (select n from fresh), (select baseline_at from item)
    from item where target_type = 'page'
  union all
  select 'PAGE_REUSE_CHANGED', 'state',
         (select count(*) from paired
           where baseline_id is not null and current_id <> baseline_id
             and coalesce(current_collation, 0) is distinct from coalesce(baseline_collation, 0)),
         null::text[], (select n from fresh), (select baseline_at from item)
    from item where target_type = 'page'
  union all
  -- First observed after the baseline: a value present now that no observation
  -- before the baseline carried.
  select 'PAGE_NEW_FORMAT_OBSERVED', 'first_observed',
         (select count(*) from paired
           where current_format is not null
             and current_format not in (
               select display_format from before_baseline where display_format is not null)),
         (select array_agg(distinct current_format) from paired
           where current_format is not null
             and current_format not in (
               select display_format from before_baseline where display_format is not null)),
         (select n from fresh), (select baseline_at from item)
    from item where target_type = 'page'
  union all
  select 'PAGE_NEW_CTA_OBSERVED', 'first_observed',
         (select count(*) from paired
           where current_cta is not null
             and current_cta not in (
               select cta_type from before_baseline where cta_type is not null)),
         (select array_agg(distinct current_cta) from paired
           where current_cta is not null
             and current_cta not in (
               select cta_type from before_baseline where cta_type is not null)),
         (select n from fresh), (select baseline_at from item)
    from item where target_type = 'page'
$$;

-- ---------------------------------------------------------------------------
-- The ads behind one signal.
--
-- Same row shape the frozen grid renders, so the card and the drawer are the
-- ones every other surface uses.
create function public.watchlist_signal_evidence(
  p_watch_id uuid,
  p_signal text default null,
  p_limit int default 24,
  p_offset int default 0
)
returns table (
  ad_archive_id text, is_active boolean, display_format text,
  publisher_platform text[], cta_type text, cta_text text, title text,
  body_text text, page_id text, page_name text, page_categories text[],
  start_date timestamptz, collation_count int,
  first_seen_at timestamptz, last_seen_at timestamptz, ad_age_days int,
  media jsonb, archive_path text, archive_status text, total_count bigint
)
language sql stable as $$
  with item as (
    select w.*,
           case w.scope_kind when 'dataset' then w.scope_dataset_id
                             when 'category' then w.scope_category_id end as scope_id
      from public.watch_items w where w.id = p_watch_id
  ), ads_watched as (
    select s.ad_ref from public.watch_scope_ads(p_watch_id) s
  ), baseline_state as (
    select t.ad_ref, t.observation_id
      from item i
      cross join lateral public.trend_state_scope(i.scope_kind, i.scope_id, i.baseline_at) t
      join ads_watched w on w.ad_ref = t.ad_ref
  ), current_state as (
    select s.ad_ref, s.observation_id
      from item i
      cross join lateral public.page_scope_observations(i.scope_kind, i.scope_id) s
      join ads_watched w on w.ad_ref = s.ad_ref
  ), before_baseline as (
    select o.display_format, o.cta_type
      from item i
      join public.datasets d
        on d.deleted_at is null
       and (i.scope_kind = 'all'
            or (i.scope_kind = 'dataset'  and d.id = i.scope_id)
            or (i.scope_kind = 'category' and d.category_id = i.scope_id))
      join public.collection_runs cr on cr.id = d.collection_run_id and cr.collected_at < i.baseline_at
      join public.ad_observations o on o.collection_run_id = cr.id
      join ads_watched w on w.ad_ref = o.ad_ref
  ), rows_in_watch as (
    select a.ad_archive_id, o.is_active, o.display_format, o.publisher_platform,
           o.cta_type, o.cta_text, o.title, o.body_text,
           p.page_id, po.page_name, po.page_categories,
           a.start_date, o.collation_count,
           a.first_seen_at, a.last_seen_at,
           (current_date - a.start_date::date)::int as ad_age_days,
           o.media, m.storage_path as archive_path, m.archive_status,
           c.observation_id as current_id, b.observation_id as baseline_id,
           bo.is_active as baseline_active, bo.collation_count as baseline_collation
      from current_state c
      left join baseline_state b on b.ad_ref = c.ad_ref
      join public.ad_observations o on o.id = c.observation_id
      left join public.ad_observations bo on bo.id = b.observation_id
      join public.ads a on a.id = c.ad_ref
      join public.pages p on p.id = a.page_ref
      left join public.page_observations po
        on po.page_ref = a.page_ref and po.collection_run_id = o.collection_run_id
      left join public.media_assets m on m.ad_observation_id = o.id
  ), filtered as (
    select r.* from rows_in_watch r, item i
     where (p_signal in ('PAGE_NEWLY_FOUND_AD', 'CATEGORY_NEWLY_FOUND_AD')
              and r.first_seen_at >= i.baseline_at and r.first_seen_at < now())
        or (p_signal = 'PAGE_STARTED_AD'
              and r.start_date >= i.baseline_at and r.start_date < now())
        or (p_signal = 'PAGE_STATUS_OBSERVED_CHANGE'
              and r.baseline_id is not null and r.current_id <> r.baseline_id
              and r.is_active is distinct from r.baseline_active)
        or (p_signal = 'PAGE_REUSE_CHANGED'
              and r.baseline_id is not null and r.current_id <> r.baseline_id
              and coalesce(r.collation_count, 0) is distinct from coalesce(r.baseline_collation, 0))
        or (p_signal = 'PAGE_NEW_FORMAT_OBSERVED'
              and r.display_format is not null
              and r.display_format not in (
                select display_format from before_baseline where display_format is not null))
        or (p_signal = 'PAGE_NEW_CTA_OBSERVED'
              and r.cta_type is not null
              and r.cta_type not in (
                select cta_type from before_baseline where cta_type is not null))
  )
  select f.ad_archive_id, f.is_active, f.display_format, f.publisher_platform,
         f.cta_type, f.cta_text, f.title, f.body_text, f.page_id, f.page_name,
         f.page_categories, f.start_date, f.collation_count,
         f.first_seen_at, f.last_seen_at, f.ad_age_days, f.media,
         f.archive_path, f.archive_status,
         (select count(*) from filtered) as total_count
    from filtered f
   order by f.first_seen_at desc, f.ad_archive_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

-- ---------------------------------------------------------------------------
-- The list.
--
-- Compact and set-based on purpose: one row per watch, no per-item intelligence
-- query. Signal counts belong to the detail page, where the reader asked for
-- them.
create function public.watchlist_list()
returns table (
  id uuid,
  target_type text,
  target_page_id text,
  target_category_id uuid,
  target_name text,
  scope_kind text,
  scope_dataset_id uuid,
  scope_category_id uuid,
  scope_name text,
  scope_available boolean,
  tracked_signals text[],
  baseline_at timestamptz,
  created_at timestamptz,
  latest_collected_at timestamptz
)
language sql stable as $$
  with scope_times as (
    -- The newest collection each scope has, resolved once for every watch
    -- rather than per row.
    select d.id as dataset_id, d.category_id, cr.collected_at
      from public.datasets d
      join public.collection_runs cr on cr.id = d.collection_run_id
     where d.deleted_at is null
  ), latest_page_name as (
    select distinct on (po.page_ref) p.page_id, po.page_name
      from public.page_observations po
      join public.pages p on p.id = po.page_ref
     order by po.page_ref, po.observed_at desc, po.id desc
  )
  select w.id, w.target_type, w.target_page_id, w.target_category_id,
         coalesce(
           case w.target_type
             when 'page' then (select page_name from latest_page_name l where l.page_id = w.target_page_id)
             else (select c.name from public.categories c
                    where c.id = w.target_category_id and c.deleted_at is null)
           end,
           -- A name we cannot read is shown as the identity we stored, which is
           -- the thing the watch actually points at.
           coalesce(w.target_page_id, w.target_category_id::text)) as target_name,
         w.scope_kind, w.scope_dataset_id, w.scope_category_id,
         case w.scope_kind
           when 'dataset' then (select d.name from public.datasets d
                                 where d.id = w.scope_dataset_id and d.deleted_at is null)
           when 'category' then (select c.name from public.categories c
                                  where c.id = w.scope_category_id and c.deleted_at is null)
           else null
         end as scope_name,
         -- False when the dataset or category behind the scope has been soft
         -- deleted: the watch is not silently widened, it is shown as unusable.
         case w.scope_kind
           when 'dataset' then exists (select 1 from public.datasets d
                                        where d.id = w.scope_dataset_id and d.deleted_at is null)
           when 'category' then exists (select 1 from public.categories c
                                         where c.id = w.scope_category_id and c.deleted_at is null)
           else true
         end as scope_available,
         w.tracked_signals, w.baseline_at, w.created_at,
         case w.scope_kind
           when 'dataset' then (select max(collected_at) from scope_times s where s.dataset_id = w.scope_dataset_id)
           when 'category' then (select max(collected_at) from scope_times s where s.category_id = w.scope_category_id)
           else (select max(collected_at) from scope_times)
         end as latest_collected_at
    from public.watch_items w
   order by w.created_at desc
$$;

-- ---------------------------------------------------------------------------
-- Moving the baseline.
--
-- The one mutation that changes what "since" means, and therefore the one the
-- server has to time itself: a caller-supplied timestamp could be backdated to
-- make old ads look new. SECURITY INVOKER, so the update is still filtered by
-- the owner policy — a watch belonging to somebody else simply matches no row.
create function public.watchlist_reset_baseline(p_watch_id uuid)
returns boolean
language sql volatile as $$
  update public.watch_items
     set baseline_at = now(), updated_at = now()
   where id = p_watch_id
  returning true
$$;

-- ---------------------------------------------------------------------------
-- Permissions. Same contract as every read function before these: the table's
-- RLS is what limits a caller to their own rows, and these functions are
-- INVOKER so that stays true through them.
do $$
declare
  fn text;
  signatures text[] := array[
    'public.watch_scope_ads(uuid)',
    'public.watchlist_signal_summary(uuid)',
    'public.watchlist_signal_evidence(uuid, text, int, int)',
    'public.watchlist_list()',
    'public.watchlist_reset_baseline(uuid)'
  ];
begin
  foreach fn in array signatures loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
    execute format('alter function %s set search_path = public, pg_temp', fn);

    if has_function_privilege('anon', fn, 'execute') then
      raise exception '% must not be executable by anon', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception '% must stay executable by authenticated', fn;
    end if;
    if (select prosecdef from pg_proc where oid = fn::regprocedure) then
      raise exception '% must stay SECURITY INVOKER so RLS decides what it returns', fn;
    end if;
  end loop;
end $$;

revoke all on table public.watch_items from public;
revoke all on table public.watch_items from anon;
grant select, insert, update, delete on table public.watch_items to authenticated;
