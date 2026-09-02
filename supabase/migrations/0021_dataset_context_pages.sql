-- Dataset-level page count in the dataset-context projection.
--
-- Dataset Detail's primary KPI must describe the dataset, not the run that fed
-- it. collection_runs.computed_unique_pages counts every page the collector saw,
-- including pages reachable only from quarantined rows, so on a partial run it
-- is larger than the dataset itself. Both numbers are facts, and they answer
-- different questions:
--
--   pages_in_dataset       — membership truth, what this dataset can be read for
--   computed_unique_pages  — run provenance, what the collector observed
--
-- Both stay in the projection. Neither is ever substituted for the other.
--
-- The return type changes, and CREATE OR REPLACE cannot change a function's
-- OUT columns, so the function is dropped and recreated. Dropping it also drops
-- its ACL, which is why the grants from 0019 are re-applied below rather than
-- assumed.

drop function if exists public.dataset_context(uuid);

create function public.dataset_context(p_dataset_id uuid)
returns table (
  dataset_id uuid, dataset_name text, category_name text,
  collection_run_id uuid, collection_method text, source_product text,
  scope_query text, scope_country text, collected_at timestamptz,
  run_status text, computed_unique_ads int, computed_unique_pages int,
  computed_source_rows int, computed_unresolved_count int,
  quarantine_count bigint, ads_in_dataset bigint, pages_in_dataset bigint
)
language sql stable as $$
  select d.id, d.name, c.name,
         r.id, r.collection_method, r.source_product,
         r.scope_query, r.scope_country, r.collected_at,
         r.status, r.computed_unique_ads, r.computed_unique_pages,
         r.computed_source_rows, r.computed_unresolved_count,
         (select count(*) from public.import_quarantine q where q.collection_run_id = r.id),
         (select count(*) from public.dataset_ads da where da.dataset_id = d.id),
         -- Same definition as dataset_list.pages_in_dataset, deliberately: one
         -- number called "Pages in this dataset" across every surface.
         (select count(distinct a.page_ref)
            from public.dataset_ads da
            join public.ads a on a.id = da.ad_ref
           where da.dataset_id = d.id)
    from public.datasets d
    join public.categories c on c.id = d.category_id
    join public.collection_runs r on r.id = d.collection_run_id
   where d.id = p_dataset_id
$$;

revoke all on function public.dataset_context(uuid) from public;
revoke all on function public.dataset_context(uuid) from anon;
grant execute on function public.dataset_context(uuid) to authenticated;
alter function public.dataset_context(uuid) set search_path = public, pg_temp;

do $$
begin
  if has_function_privilege('anon', 'public.dataset_context(uuid)', 'execute') then
    raise exception 'public.dataset_context(uuid) must not be executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.dataset_context(uuid)', 'execute') then
    raise exception 'public.dataset_context(uuid) must stay executable by authenticated';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.dataset_context(uuid)'::regprocedure) then
    raise exception 'public.dataset_context(uuid) must stay SECURITY INVOKER so RLS applies';
  end if;
end $$;
