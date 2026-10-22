-- Drops the requests table. Logins created by sign-up stay in auth.users: an approved one keeps its role,
-- a pending one stays unconfirmed (cannot sign in) until removed by hand in the Supabase dashboard.
drop table if exists public.access_requests;
notify pgrst,'reload schema';
