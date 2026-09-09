-- Brand mapping foundation (P2.8): an explicit, human-made Page → Brand grouping.
--
-- WHAT THIS IS: editorial data. A researcher decides that these Pages are the
-- same advertiser and records that decision, with their name on it and a date
-- attached. Nothing here is derived from the collector, and nothing here is
-- inferred.
--
-- WHAT THIS IS NOT: an identity rule. `Page != Brand` stays frozen — no Page
-- becomes a Brand because its name looks similar, no name match creates a
-- mapping, and no model writes one. There is no fuzzy linking, no confidence
-- and no automatic merge, because a wrong grouping is invisible once it is
-- stored: every later Brand number would simply be wrong and look fine.
--
-- The mapping is TEMPORAL. A Page can be renamed, repurposed, sold, or mapped
-- by mistake and corrected months later. Overwriting a brand id in place would
-- make the correction rewrite history — every past observation would silently
-- become the new Brand's. So a mapping is an interval, and a change closes one
-- interval and opens the next.

-- Needed for the exclusion constraint below: it compares a text page_id with =
-- and an interval with &&, which core GiST cannot do on its own.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- The normalized form of a Brand name.
--
-- Used for uniqueness and for finding a near-duplicate before somebody creates
-- a second "Glory Thailand". It is a comparison aid ONLY: two names normalizing
-- to the same string are refused so a person can decide, never merged.
create function public.brand_normalized_name(p_name text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')))
$$;

-- ---------------------------------------------------------------------------
-- The canonical Brand.
--
-- Identity is the uuid, never the name: renaming "Glory" to "Glory Thailand"
-- must not break a single mapping, and it does not.
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  -- active or archived. Archived keeps every mapping it ever had; it simply
  -- stops accepting new ones. Deleting a Brand would delete the record of a
  -- human decision, which is the one thing this table exists to keep.
  status text not null default 'active' check (status in ('active', 'archived')),
  -- Internal editorial note. Never an input to any deterministic number.
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One canonical name, compared in normalized form. Not a similarity match: an
-- equal normalized name is refused, and anything less than equal is left alone.
create unique index brands_normalized_name_unique
  on public.brands (public.brand_normalized_name(name));

create index brands_status_idx on public.brands (status, name);

comment on table public.brands is
  'Editorial Brand identity, created and maintained by people. Not derived from collector data.';

-- ---------------------------------------------------------------------------
-- The mapping, as an interval.
--
-- `valid_from` inclusive, `valid_to` exclusive and null while current. A move
-- closes the old row and opens a new one inside one transaction; nothing is
-- ever updated in place except the end of an interval.
create table public.brand_page_mappings (
  id uuid primary key default gen_random_uuid(),
  -- restrict, not cascade: a Brand with history cannot be deleted out from
  -- under the decisions that reference it.
  brand_id uuid not null references public.brands(id) on delete restrict,
  page_id text not null references public.pages(page_id) on delete cascade,

  valid_from timestamptz not null default now(),
  valid_to timestamptz,

  -- Editorial provenance: who decided, and when. The label is a snapshot taken
  -- at the time, so the record still reads correctly after an account is
  -- removed — auth.users is not readable from the app's role.
  mapped_by uuid references auth.users(id) on delete set null,
  mapped_by_label text,
  ended_by uuid references auth.users(id) on delete set null,
  ended_by_label text,
  note text check (note is null or length(note) <= 500),

  created_at timestamptz not null default now(),

  constraint brand_mapping_period check (valid_to is null or valid_to > valid_from)
);

-- The invariant, in the database rather than in a code path somebody can
-- forget: one Page has at most one Brand at any instant, and its mapping
-- intervals never overlap. A Brand may hold as many Pages as it likes.
alter table public.brand_page_mappings
  add constraint brand_page_mappings_no_overlap
  exclude using gist (
    page_id with =,
    tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz)) with &&
  );

-- Intentional access paths for the two lookups every surface makes: "which
-- Brand is this Page in now" and "which Pages does this Brand hold now".
create index brand_page_mappings_active_page
  on public.brand_page_mappings (page_id) where valid_to is null;
create index brand_page_mappings_active_brand
  on public.brand_page_mappings (brand_id) where valid_to is null;
create index brand_page_mappings_history
  on public.brand_page_mappings (brand_id, valid_from desc);

comment on table public.brand_page_mappings is
  'Human Page-to-Brand decisions as intervals. A correction closes an interval; it never erases one.';

-- ---------------------------------------------------------------------------
-- Ownership.
--
-- This is shared canonical editorial data, so it follows the standing rule the
-- imported tables use — read with a role, write as analyst or admin — and NOT
-- the own-row rule Watchlist uses. A Watchlist is one person's note to
-- themselves; a Brand mapping changes what every researcher sees.
alter table public.brands enable row level security;
alter table public.brand_page_mappings enable row level security;

create policy brands_read on public.brands
  for select to authenticated using (public.current_user_role() is not null);
create policy brands_write on public.brands
  for insert to authenticated
  with check (public.current_user_role() in ('analyst', 'admin'));
create policy brands_update on public.brands
  for update to authenticated
  using (public.current_user_role() in ('analyst', 'admin'))
  with check (public.current_user_role() in ('analyst', 'admin'));
create policy brands_delete on public.brands
  for delete to authenticated using (public.current_user_role() = 'admin');

create policy brand_page_mappings_read on public.brand_page_mappings
  for select to authenticated using (public.current_user_role() is not null);
create policy brand_page_mappings_write on public.brand_page_mappings
  for insert to authenticated
  with check (public.current_user_role() in ('analyst', 'admin'));
create policy brand_page_mappings_update on public.brand_page_mappings
  for update to authenticated
  using (public.current_user_role() in ('analyst', 'admin'))
  with check (public.current_user_role() in ('analyst', 'admin'));
create policy brand_page_mappings_delete on public.brand_page_mappings
  for delete to authenticated using (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- THE mapping rule.
--
-- One definition of "which Brand held which Page", parameterised by the instant
-- being asked about. Every other function here reads it — a screen that wrote
-- its own version of `valid_to is null` would eventually disagree with the one
-- next to it, and neither would look wrong.
--
-- `brand_mapping_at(now())` is the current view. There is no second rule for
-- "current".
create function public.brand_mapping_at(p_at timestamptz)
returns table (
  mapping_id uuid,
  page_id text,
  brand_id uuid,
  valid_from timestamptz,
  valid_to timestamptz
)
language sql stable as $$
  select m.id, m.page_id, m.brand_id, m.valid_from, m.valid_to
    from public.brand_page_mappings m
   where m.valid_from <= p_at
     and (m.valid_to is null or m.valid_to > p_at)
$$;

-- ---------------------------------------------------------------------------
-- The Brand a Page is in right now, for the Page surfaces.
create function public.page_brand(p_page_id text)
returns table (
  brand_id uuid,
  brand_name text,
  brand_status text,
  mapped_since timestamptz,
  mapped_by_label text,
  note text
)
language sql stable as $$
  select b.id, b.name, b.status, m.valid_from, pm.mapped_by_label, pm.note
    from public.brand_mapping_at(now()) m
    join public.brand_page_mappings pm on pm.id = m.mapping_id
    join public.brands b on b.id = m.brand_id
   where m.page_id = p_page_id
$$;

-- ---------------------------------------------------------------------------
-- The Brand list.
--
-- Management data only: identity, status, how many Pages are grouped, and when
-- the grouping last changed. No ad counts — a Brand total needs a stated data
-- scope, and a list row has nowhere to state one.
create function public.brand_list(
  p_search text default null,
  p_status text default 'active',
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  id uuid,
  name text,
  status text,
  notes text,
  active_pages bigint,
  mapped_pages_ever bigint,
  last_mapping_change timestamptz,
  created_at timestamptz,
  total_count bigint
)
language sql stable as $$
  with filtered as (
    select b.*
      from public.brands b
     where (p_status is null or p_status = 'all' or b.status = p_status)
       and (p_search is null or btrim(p_search) = ''
            or public.brand_normalized_name(b.name)
               like '%' || public.brand_normalized_name(p_search) || '%')
  ), counted as (
    select f.id,
           -- count(m.id), not count(*): the left join gives a Brand with no
           -- mappings one all-null row, whose null valid_to would otherwise
           -- pass the filter and report a Page that does not exist.
           count(m.id) filter (where m.valid_to is null) as active_pages,
           count(distinct m.page_id) as mapped_pages_ever,
           max(greatest(m.valid_from, coalesce(m.valid_to, m.valid_from))) as last_change
      from filtered f
      left join public.brand_page_mappings m on m.brand_id = f.id
     group by f.id
  )
  select f.id, f.name, f.status, f.notes,
         coalesce(c.active_pages, 0), coalesce(c.mapped_pages_ever, 0),
         c.last_change, f.created_at,
         (select count(*) from filtered) as total_count
    from filtered f
    left join counted c on c.id = f.id
   order by f.name
   limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

-- ---------------------------------------------------------------------------
-- One Brand, and the ads its CURRENT Pages account for in ONE stated scope.
--
-- `observed_ads` is a count of distinct ads reached through the Pages mapped to
-- this Brand *today*, inside the scope the caller names. It is not a historical
-- attribution: a Page that moved here last week brings its ads with it, and the
-- surface says so. It is also not a market number, a share or a spend.
create function public.brand_detail(
  p_brand_id uuid,
  p_scope text default 'all',
  p_scope_id uuid default null
)
returns table (
  id uuid,
  name text,
  status text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  active_pages bigint,
  pages_in_scope bigint,
  observed_ads bigint,
  first_observed_at timestamptz,
  last_observed_at timestamptz
)
language sql stable as $$
  with brand as (
    select * from public.brands where id = p_brand_id
  ), mapped as (
    select m.page_id
      from public.brand_mapping_at(now()) m
     where m.brand_id = p_brand_id
  ), ads_in_scope as (
    -- The frozen membership primitive, filtered to this Brand's current Pages.
    -- Distinct by ad master, so an ad seen through two Pages or two datasets is
    -- one ad here.
    select distinct s.ad_ref, p.page_id
      from public.page_scope_ads(p_scope, p_scope_id) s
      join public.ads a on a.id = s.ad_ref
      join public.pages p on p.id = a.page_ref
      join mapped mp on mp.page_id = p.page_id
  ), seen as (
    select min(cr.collected_at) as first_at, max(cr.collected_at) as last_at
      from public.page_observations po
      join public.pages p on p.id = po.page_ref
      join mapped mp on mp.page_id = p.page_id
      join public.collection_runs cr on cr.id = po.collection_run_id
      join public.datasets d on d.collection_run_id = cr.id and d.deleted_at is null
     where p_scope = 'all'
        or (p_scope = 'dataset' and d.id = p_scope_id)
        or (p_scope = 'category' and d.category_id = p_scope_id)
  )
  select b.id, b.name, b.status, b.notes, b.created_at, b.updated_at,
         (select count(*) from mapped),
         (select count(distinct page_id) from ads_in_scope),
         (select count(distinct ad_ref) from ads_in_scope),
         (select first_at from seen), (select last_at from seen)
    from brand b
$$;

-- ---------------------------------------------------------------------------
-- The Pages a Brand currently holds, with the observed context a researcher
-- needs to tell them apart — same numbers the Page surfaces show, same scope.
create function public.brand_pages(
  p_brand_id uuid,
  p_scope text default 'all',
  p_scope_id uuid default null
)
returns table (
  page_id text,
  page_name text,
  page_categories text[],
  observed_ads bigint,
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  mapping_id uuid,
  mapped_since timestamptz,
  mapped_by_label text,
  note text
)
language sql stable as $$
  with mapped as (
    select m.mapping_id, m.page_id, m.valid_from
      from public.brand_mapping_at(now()) m
     where m.brand_id = p_brand_id
  ), in_scope as (
    select p.page_id, count(distinct s.ad_ref) as observed_ads
      from public.page_scope_ads(p_scope, p_scope_id) s
      join public.ads a on a.id = s.ad_ref
      join public.pages p on p.id = a.page_ref
      join mapped mp on mp.page_id = p.page_id
     group by p.page_id
  ), latest_page as (
    -- The most recently observed name and categories in this scope. A page seen
    -- in three runs has three names on record; the current one is what a
    -- management surface should show.
    select distinct on (p.page_id)
           p.page_id, po.page_name, po.page_categories
      from public.page_observations po
      join public.pages p on p.id = po.page_ref
      join mapped mp on mp.page_id = p.page_id
      join public.datasets d
        on d.collection_run_id = po.collection_run_id and d.deleted_at is null
     where p_scope = 'all'
        or (p_scope = 'dataset' and d.id = p_scope_id)
        or (p_scope = 'category' and d.category_id = p_scope_id)
     order by p.page_id, po.observed_at desc, po.id desc
  ), seen as (
    select p.page_id,
           min(cr.collected_at) as first_at, max(cr.collected_at) as last_at
      from public.page_observations po
      join public.pages p on p.id = po.page_ref
      join mapped mp on mp.page_id = p.page_id
      join public.collection_runs cr on cr.id = po.collection_run_id
      join public.datasets d on d.collection_run_id = cr.id and d.deleted_at is null
     where p_scope = 'all'
        or (p_scope = 'dataset' and d.id = p_scope_id)
        or (p_scope = 'category' and d.category_id = p_scope_id)
     group by p.page_id
  )
  select mp.page_id, lp.page_name, lp.page_categories,
         coalesce(sc.observed_ads, 0),
         sn.first_at, sn.last_at,
         mp.mapping_id, mp.valid_from, m.mapped_by_label, m.note
    from mapped mp
    join public.brand_page_mappings m on m.id = mp.mapping_id
    left join in_scope sc on sc.page_id = mp.page_id
    left join latest_page lp on lp.page_id = mp.page_id
    left join seen sn on sn.page_id = mp.page_id
   order by coalesce(sc.observed_ads, 0) desc, mp.page_id
$$;

-- ---------------------------------------------------------------------------
-- Mapping history, for a Brand or for a Page.
--
-- Both filters are optional and both are applied, so one function answers "what
-- happened to this Brand" and "where has this Page been" with the same rows and
-- the same ordering.
create function public.brand_mapping_history(
  p_brand_id uuid default null,
  p_page_id text default null,
  p_limit int default 100
)
returns table (
  mapping_id uuid,
  brand_id uuid,
  brand_name text,
  page_id text,
  page_name text,
  valid_from timestamptz,
  valid_to timestamptz,
  is_current boolean,
  mapped_by_label text,
  ended_by_label text,
  note text
)
language sql stable as $$
  with rows_in as (
    select m.*
      from public.brand_page_mappings m
     where (p_brand_id is null or m.brand_id = p_brand_id)
       and (p_page_id is null or m.page_id = p_page_id)
  ), latest_name as (
    select distinct on (p.page_id) p.page_id, po.page_name
      from public.page_observations po
      join public.pages p on p.id = po.page_ref
      join rows_in r on r.page_id = p.page_id
      join public.datasets d
        on d.collection_run_id = po.collection_run_id and d.deleted_at is null
     order by p.page_id, po.observed_at desc, po.id desc
  )
  select r.id, r.brand_id, b.name, r.page_id, ln.page_name,
         r.valid_from, r.valid_to, r.valid_to is null,
         r.mapped_by_label, r.ended_by_label, r.note
    from rows_in r
    join public.brands b on b.id = r.brand_id
    left join latest_name ln on ln.page_id = r.page_id
   order by r.valid_from desc, r.id
   limit greatest(p_limit, 0)
$$;

-- ---------------------------------------------------------------------------
-- The review queue.
--
-- An unmapped Page is a canonical Page with no active mapping. That is not an
-- error and not a data-quality tier — it is work nobody has done yet, so the
-- ordering is about review efficiency, never about likelihood.
create function public.unmapped_pages(
  p_scope text default 'all',
  p_scope_id uuid default null,
  p_search text default null,
  p_sort text default 'observed_ads',
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  page_id text,
  page_name text,
  page_categories text[],
  observed_ads bigint,
  recently_found bigint,
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  total_count bigint
)
language sql stable as $$
  with scope_ads as (
    select s.ad_ref, a.page_ref, a.first_seen_at
      from public.page_scope_ads(p_scope, p_scope_id) s
      join public.ads a on a.id = s.ad_ref
  ), by_page as (
    select p.page_id, p.id as page_ref,
           count(distinct sa.ad_ref) as observed_ads,
           count(distinct sa.ad_ref) filter (
             where sa.first_seen_at >= now() - interval '30 days') as recently_found
      from scope_ads sa
      join public.pages p on p.id = sa.page_ref
     group by p.page_id, p.id
  ), unmapped as (
    select b.*
      from by_page b
     where not exists (
       select 1 from public.brand_mapping_at(now()) m where m.page_id = b.page_id
     )
  ), latest_page as (
    select distinct on (po.page_ref)
           po.page_ref, po.page_name, po.page_categories
      from public.page_observations po
      join unmapped u on u.page_ref = po.page_ref
      join public.datasets d
        on d.collection_run_id = po.collection_run_id and d.deleted_at is null
     where p_scope = 'all'
        or (p_scope = 'dataset' and d.id = p_scope_id)
        or (p_scope = 'category' and d.category_id = p_scope_id)
     order by po.page_ref, po.observed_at desc, po.id desc
  ), seen as (
    select po.page_ref,
           min(cr.collected_at) as first_at, max(cr.collected_at) as last_at
      from public.page_observations po
      join unmapped u on u.page_ref = po.page_ref
      join public.collection_runs cr on cr.id = po.collection_run_id
      join public.datasets d on d.collection_run_id = cr.id and d.deleted_at is null
     where p_scope = 'all'
        or (p_scope = 'dataset' and d.id = p_scope_id)
        or (p_scope = 'category' and d.category_id = p_scope_id)
     group by po.page_ref
  ), matched as (
    select u.page_id, lp.page_name, lp.page_categories,
           u.observed_ads, u.recently_found, s.first_at, s.last_at
      from unmapped u
      left join latest_page lp on lp.page_ref = u.page_ref
      left join seen s on s.page_ref = u.page_ref
     where p_search is null or btrim(p_search) = ''
        or u.page_id like '%' || btrim(p_search) || '%'
        or lower(coalesce(lp.page_name, '')) like '%' || lower(btrim(p_search)) || '%'
  )
  select m.page_id, m.page_name, m.page_categories,
         m.observed_ads, m.recently_found, m.first_at, m.last_at,
         (select count(*) from matched) as total_count
    from matched m
   order by
     case when p_sort = 'observed_ads'    then m.observed_ads end desc nulls last,
     case when p_sort = 'recently_found'  then m.recently_found end desc nulls last,
     case when p_sort = 'last_observed'   then m.last_at end desc nulls last,
     case when p_sort = 'page_name'       then lower(coalesce(m.page_name, '')) end asc nulls last,
     m.page_id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;

-- ---------------------------------------------------------------------------
-- Mapping a Page, including moving it.
--
-- One function for both, because "move" is not a different operation: it is a
-- mapping that happens to close a previous one, and doing it in two calls would
-- leave a moment with no mapping — or worse, two.
--
-- SECURITY INVOKER on purpose: the write policies on both tables are what allow
-- or refuse this, so the function cannot become a way around them. The role
-- check below is the explicit refusal, not the boundary.
create function public.brand_map_page(
  p_brand_id uuid,
  p_page_id text,
  p_note text default null,
  p_actor_label text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_status text;
  v_current_brand uuid;
  v_current_id uuid;
  v_closed_at timestamptz;
  v_new uuid;
begin
  if coalesce(public.current_user_role(), '') not in ('analyst', 'admin') then
    raise exception 'brand mapping requires the analyst role'
      using errcode = '42501';
  end if;

  select status into v_status from public.brands where id = p_brand_id;
  if v_status is null then
    raise exception 'brand not found' using errcode = '23503';
  end if;
  -- An archived Brand keeps its history and stops taking new Pages. Mapping
  -- into one would quietly resurrect a grouping somebody retired.
  if v_status <> 'active' then
    raise exception 'cannot map a page to an archived brand' using errcode = '23514';
  end if;
  if not exists (select 1 from public.pages where page_id = p_page_id) then
    raise exception 'page not found' using errcode = '23503';
  end if;

  -- clock_timestamp(), not now(): a mapping made earlier in THIS transaction
  -- starts after the transaction did, and reading at now() would not see it —
  -- the function would then map the same Page twice and the exclusion
  -- constraint would be the only thing left to object.
  select m.brand_id, m.mapping_id into v_current_brand, v_current_id
    from public.brand_mapping_at(clock_timestamp()) m
   where m.page_id = p_page_id;

  -- Already here: nothing to record. Closing and reopening would invent a
  -- decision nobody made and put a false date on the current one.
  if v_current_brand = p_brand_id then
    return v_current_id;
  end if;

  /*
   * Close the old interval, and start the new one at exactly that instant:
   * adjacent, never overlapping, never a gap.
   *
   * clock_timestamp() rather than now(), and never earlier than a microsecond
   * after the row began. now() is the transaction's start time, so mapping and
   * then moving a Page inside ONE transaction would try to close an interval at
   * the instant it opened — a zero-length decision the period check rightly
   * refuses. The mapping still has to move.
   */
  update public.brand_page_mappings
     set valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond'),
         ended_by = v_actor, ended_by_label = p_actor_label
   where page_id = p_page_id and valid_to is null
  returning valid_to into v_closed_at;

  insert into public.brand_page_mappings
    (brand_id, page_id, valid_from, mapped_by, mapped_by_label, note)
  values
    (p_brand_id, p_page_id, coalesce(v_closed_at, clock_timestamp()),
     v_actor, p_actor_label,
     nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_new;

  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- Unmapping: closes the current interval and keeps every row.
--
-- The Page returns to the review queue. What was decided before stays on the
-- record, because "this was wrong" is itself a fact worth keeping.
create function public.brand_unmap_page(
  p_page_id text,
  p_actor_label text default null
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rows int;
begin
  if coalesce(public.current_user_role(), '') not in ('analyst', 'admin') then
    raise exception 'brand mapping requires the analyst role'
      using errcode = '42501';
  end if;

  -- Same clock as brand_map_page, for the same reason: a Page mapped and
  -- unmapped inside one transaction still has an interval, however short.
  update public.brand_page_mappings
     set valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond'),
         ended_by = auth.uid(), ended_by_label = p_actor_label
   where page_id = p_page_id and valid_to is null;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

-- ---------------------------------------------------------------------------
-- Permissions. Same contract as every function before these, mutations
-- included: INVOKER, so RLS decides; anon and PUBLIC hold nothing.
do $$
declare
  fn text;
  signatures text[] := array[
    'public.brand_normalized_name(text)',
    'public.brand_mapping_at(timestamptz)',
    'public.page_brand(text)',
    'public.brand_list(text, text, int, int)',
    'public.brand_detail(uuid, text, uuid)',
    'public.brand_pages(uuid, text, uuid)',
    'public.brand_mapping_history(uuid, text, int)',
    'public.unmapped_pages(text, uuid, text, text, int, int)',
    'public.brand_map_page(uuid, text, text, text)',
    'public.brand_unmap_page(text, text)'
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
      raise exception '% must stay SECURITY INVOKER so RLS decides what it does', fn;
    end if;
  end loop;
end $$;

revoke all on table public.brands from public;
revoke all on table public.brands from anon;
revoke all on table public.brand_page_mappings from public;
revoke all on table public.brand_page_mappings from anon;
grant select, insert, update, delete on table public.brands to authenticated;
grant select, insert, update, delete on table public.brand_page_mappings to authenticated;
