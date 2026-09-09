-- Drops the Brand mapping foundation.
--
-- This removes human editorial decisions, not imported data. Nothing about
-- pages, ads, observations or datasets changes. btree_gist is left installed:
-- an extension is cheap, and dropping one this migration merely enabled could
-- take something else with it.

drop function if exists public.brand_unmap_page(text, text);
drop function if exists public.brand_map_page(uuid, text, text, text);
drop function if exists public.unmapped_pages(text, uuid, text, text, int, int);
drop function if exists public.brand_mapping_history(uuid, text, int);
drop function if exists public.brand_pages(uuid, text, uuid);
drop function if exists public.brand_detail(uuid, text, uuid);
drop function if exists public.brand_list(text, text, int, int);
drop function if exists public.page_brand(text);
drop function if exists public.brand_mapping_at(timestamptz);

drop table if exists public.brand_page_mappings;
drop table if exists public.brands;

-- After the table, because the unique index depends on it.
drop function if exists public.brand_normalized_name(text);
