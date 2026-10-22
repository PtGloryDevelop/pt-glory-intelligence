-- Read-only function; dropping it touches no data (the offers comparison then shows its error state for our side).
drop function if exists public.owned_unit_copy(uuid,uuid,date,date);
notify pgrst,'reload schema';
