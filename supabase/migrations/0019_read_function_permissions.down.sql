-- Restores the Postgres defaults 0018 relied on: PUBLIC execute, caller search_path.
do $$
declare
  fn text;
  signatures text[] := array[
    'public.dataset_context(uuid)',
    'public.dataset_ads_page(uuid, text, text, text, text, text, text, int, int)',
    'public.dataset_ads_facets(uuid)',
    'public.ad_detail(text, uuid)',
    'public.ad_observation_history(text)'
  ];
begin
  execute 'grant execute on function public.current_user_role() to anon';
  execute 'alter default privileges in schema public grant execute on functions to anon';
  foreach fn in array signatures loop
    execute format('alter function %s reset search_path', fn);
    execute format('grant execute on function %s to public', fn);
  end loop;
end $$;
