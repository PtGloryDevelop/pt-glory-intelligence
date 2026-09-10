-- Removes the collection-filter read.
--
-- Rolling this back does not change a single count; it removes the sentence
-- that stops "Inactive 0" being read as "this advertiser never stops an ad"
-- when the collection only ever asked for active ones.

drop function if exists public.scope_collection_filters(text, uuid);
