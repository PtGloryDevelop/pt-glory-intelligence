-- What the collection ASKED FOR, so a number cannot be read as more than it is.
--
-- FOUND IN PILOT, on real data. A Page showed `Active 28 · Inactive 0 ·
-- ไม่ทราบ 0`, which reads as "this advertiser has never stopped an ad". It is
-- nothing of the sort: both runs in that scope were collected with
-- `active_status = 'active'`, so a stopped ad was never eligible to appear. The
-- zero is a property of the search, not a finding about the page.
--
-- The value was recorded on `collection_runs` from the first migration onward
-- and simply never reached a screen. This exposes it, and nothing else: no
-- existing function changes, no count changes, no semantics change.
--
-- One row per scope, describing the runs behind it. `mixed` is returned when
-- the runs disagree, because a scope assembled from an active-only run and an
-- all-status run cannot be summarised by either.

create function public.scope_collection_filters(
  p_scope text,
  p_scope_id uuid default null
)
returns table (
  runs bigint,
  active_status text,
  ad_type text,
  media_type text,
  countries text[],
  queries text[]
)
language sql stable as $$
  with runs_in_scope as (
    select distinct r.id, r.scope_active_status, r.scope_ad_type,
           r.scope_media_type, r.scope_country, r.scope_query
      from public.collection_runs r
      join public.datasets d
        on d.collection_run_id = r.id
       and d.deleted_at is null
       and (p_scope = 'all'
            or (p_scope = 'dataset'  and d.id = p_scope_id)
            or (p_scope = 'category' and d.category_id = p_scope_id))
  )
  select count(*),
         -- One value when every run agrees; 'mixed' when they do not; null when
         -- the collector never recorded it.
         case when count(distinct scope_active_status) = 1
              then min(scope_active_status) else
                case when count(*) filter (where scope_active_status is not null) = 0
                     then null else 'mixed' end end,
         case when count(distinct scope_ad_type) = 1
              then min(scope_ad_type) else
                case when count(*) filter (where scope_ad_type is not null) = 0
                     then null else 'mixed' end end,
         case when count(distinct scope_media_type) = 1
              then min(scope_media_type) else
                case when count(*) filter (where scope_media_type is not null) = 0
                     then null else 'mixed' end end,
         array_remove(array_agg(distinct scope_country), null),
         array_remove(array_agg(distinct scope_query), null)
    from runs_in_scope
$$;

do $$
declare
  fn text := 'public.scope_collection_filters(text, uuid)';
begin
  execute format('revoke all on function %s from public', fn);
  execute format('revoke all on function %s from anon', fn);
  execute format('grant execute on function %s to authenticated', fn);
  execute format('alter function %s set search_path = public, pg_temp', fn);

  if has_function_privilege('anon', fn, 'execute') then
    raise exception '% must not be executable by anon', fn;
  end if;
  if (select prosecdef from pg_proc where oid = fn::regprocedure) then
    raise exception '% must stay SECURITY INVOKER', fn;
  end if;
end $$;
