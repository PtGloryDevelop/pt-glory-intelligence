-- Read-function permissions and resolution safety.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, so migration
-- 0018 left the read API callable by `anon` — and by any future role — purely
-- by accident. RLS still returned nothing to a caller without a role row, but
-- an accidental permission is not a control. These are the two changes:
--
--   1. EXECUTE only for `authenticated`. `anon` and PUBLIC lose it outright.
--   2. A pinned search_path, so object and operator resolution cannot be
--      steered by whatever search_path the caller happens to be running with.
--
-- ALTER FUNCTION ... SET is used instead of recreating the bodies: it leaves
-- SECURITY INVOKER untouched, so RLS keeps applying as the calling user and
-- dbUser() stays the boundary it already was.

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
  foreach fn in array signatures loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
    -- pg_temp last, so a caller cannot shadow a public object with a temp one.
    execute format('alter function %s set search_path = public, pg_temp', fn);
  end loop;
end $$;

-- 0002 did `revoke all on function current_user_role() from public`, which was
-- not enough. Supabase ships default privileges that grant EXECUTE on every new
-- function in `public` to anon, authenticated and service_role individually, so
-- the ACL kept an explicit `anon=X` entry that revoking from PUBLIC never
-- touched. Revoking from the role by name is what actually removes it.
revoke all on function public.current_user_role() from anon;

-- Stop the same default from re-granting anything created later.
alter default privileges in schema public revoke execute on functions from anon;

do $$
declare
  fn text;
  signatures text[] := array[
    'public.current_user_role()',
    'public.dataset_context(uuid)',
    'public.dataset_ads_page(uuid, text, text, text, text, text, text, int, int)',
    'public.dataset_ads_facets(uuid)',
    'public.ad_detail(text, uuid)',
    'public.ad_observation_history(text)'
  ];
begin
  foreach fn in array signatures loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception '% must not be executable by anon', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception '% must stay executable by authenticated', fn;
    end if;
  end loop;
end $$;
