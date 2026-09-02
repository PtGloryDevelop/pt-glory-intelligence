-- Restores the 0018 shape of dataset_context, without pages_in_dataset, and
-- re-applies the 0019 permissions the drop removes. Nothing is stored by 0021,
-- so no data is lost either way.

drop function if exists public.dataset_context(uuid);

create function public.dataset_context(p_dataset_id uuid)
returns table (
  dataset_id uuid, dataset_name text, category_name text,
  collection_run_id uuid, collection_method text, source_product text,
  scope_query text, scope_country text, collected_at timestamptz,
  run_status text, computed_unique_ads int, computed_unique_pages int,
  computed_source_rows int, computed_unresolved_count int,
  quarantine_count bigint, ads_in_dataset bigint
)
language sql stable as $$
  select d.id, d.name, c.name,
         r.id, r.collection_method, r.source_product,
         r.scope_query, r.scope_country, r.collected_at,
         r.status, r.computed_unique_ads, r.computed_unique_pages,
         r.computed_source_rows, r.computed_unresolved_count,
         (select count(*) from public.import_quarantine q where q.collection_run_id = r.id),
         (select count(*) from public.dataset_ads da where da.dataset_id = d.id)
    from public.datasets d
    join public.categories c on c.id = d.category_id
    join public.collection_runs r on r.id = d.collection_run_id
   where d.id = p_dataset_id
$$;

revoke all on function public.dataset_context(uuid) from public;
revoke all on function public.dataset_context(uuid) from anon;
grant execute on function public.dataset_context(uuid) to authenticated;
alter function public.dataset_context(uuid) set search_path = public, pg_temp;
