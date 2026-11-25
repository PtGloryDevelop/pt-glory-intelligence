-- Rollback of 0081: getOwnedPerformance must go back to the RPCs' own snapshot-wide page lists first
-- (it calls owned_page_choices), so deploy the previous app build before running this.
drop function if exists public.owned_page_choices(uuid, date, date, text, text);
notify pgrst, 'reload schema';
