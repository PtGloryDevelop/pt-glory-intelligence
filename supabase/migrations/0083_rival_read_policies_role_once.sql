-- The read policies on the four rival tables asked public.current_user_role() again for every row a
-- query touched: reading every ad's latest copy meant about 20,000 lookups of the caller's one role
-- row, and reads under the caller's own rights ran about 3 times slower than the same query without
-- the policy (measured on the pilot, 2026-11-26; it is part of why the rival board passed the 8 s
-- statement limit that day).
--
-- A scalar subquery is evaluated once per statement, so the question is asked once and its answer
-- used for every row. Who may read does not change: the answer is the same for every row of a
-- statement already (the function is stable and reads only the caller's own role row), and these
-- four policies have no other condition.
--
-- Only the four SELECT policies change. Insert, update and delete policies are left as they are:
-- writes to these tables come from the import on the privileged connection.
--
-- ALTER POLICY needs each table for an instant; give up after 3 s instead of making readers queue
-- behind a waiting lock (run the migration again if that happens).
set local lock_timeout = '3s';
alter policy pages_read             on public.pages             using ((select public.current_user_role()) is not null);
alter policy page_observations_read on public.page_observations using ((select public.current_user_role()) is not null);
alter policy ads_read               on public.ads               using ((select public.current_user_role()) is not null);
alter policy ad_observations_read   on public.ad_observations   using ((select public.current_user_role()) is not null);
