-- Drops the forgot-password requests. Links already created keep working until they expire; nothing else depends on the table.
drop table if exists public.password_reset_requests;
notify pgrst,'reload schema';
