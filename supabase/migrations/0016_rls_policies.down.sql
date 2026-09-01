do $$
declare t text;
begin
  foreach t in array array[
    'user_roles','categories','collection_runs','datasets','pages','page_observations',
    'ads','ad_observations','dataset_ads','dataset_quality','import_quarantine',
    'app_settings','audit_logs'
  ] loop
    execute format('alter table public.%1$s disable row level security', t);
    execute format(
      'do $inner$ declare p record; begin
         for p in select policyname from pg_policies
           where schemaname = ''public'' and tablename = %1$L
         loop execute format(''drop policy %%I on public.%1$s'', p.policyname); end loop;
       end $inner$;', t);
  end loop;
end $$;
