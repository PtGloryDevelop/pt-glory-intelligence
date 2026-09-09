-- Closes the one hole the P2.6 foundation audit found.
--
-- Every read function this product exposes is revoked from PUBLIC and anon and
-- has its search_path pinned — asserted by each migration that creates one. But
-- each migration only asserts its OWN group, and `jsonb_text_array` (0017) was
-- created before that convention existed. It kept the PostgreSQL default of
-- EXECUTE to PUBLIC, and therefore to `anon`.
--
-- It reads no table and has no side effect, so nothing was exposed. What it did
-- do is contradict the posture every other function follows, and leave an
-- unauthenticated caller a function to spend CPU on. Both are cheap to remove.
--
-- No index is added here. The audit's EXPLAIN work found every read using the
-- indexes from 0015 and 0023 — no sequential scan on a large table, no missing
-- access path — so there is nothing an index would correct.

revoke all on function public.jsonb_text_array(jsonb) from public;
revoke all on function public.jsonb_text_array(jsonb) from anon;
-- The import path runs privileged; no app role needs to call this directly.
alter function public.jsonb_text_array(jsonb) set search_path = public, pg_temp;

do $$
begin
  if has_function_privilege('anon', 'public.jsonb_text_array(jsonb)', 'execute') then
    raise exception 'jsonb_text_array must not be executable by anon';
  end if;

  /*
   * The sweep the audit ran by hand, kept as a migration-time assertion: no
   * function THIS PRODUCT defines may be left executable by PUBLIC.
   *
   * Extension-owned functions are excluded. pg_trgm installs thirty of them in
   * `public` with EXECUTE to PUBLIC, which is how extensions are meant to work
   * — revoking those would break the trigram index the Explorer search uses,
   * and they are not ours to re-permission.
   */
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(p.proacl) a
     where n.nspname = 'public'
       and p.prokind = 'f'
       and a.grantee = 0
       and not exists (
         select 1 from pg_depend d
          where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
       )
  ) then
    raise exception 'a function this product defines is still granted to PUBLIC';
  end if;
end $$;
