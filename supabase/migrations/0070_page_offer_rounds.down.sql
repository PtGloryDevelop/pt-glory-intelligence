-- Read-only function; dropping it touches no data (offer changes then say they could not be read).
drop function if exists public.page_offer_rounds(text);
notify pgrst,'reload schema';
