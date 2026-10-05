-- Read-only function; dropping it touches no data (the unit summary panel then shows its error state).
drop function if exists public.owned_performance_units(uuid,date,date);
notify pgrst,'reload schema';
