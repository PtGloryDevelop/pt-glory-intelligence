-- Restores the PostgreSQL default for jsonb_text_array. 0031 changes no data
-- and no behaviour, only who may call one helper.

grant execute on function public.jsonb_text_array(jsonb) to public;
alter function public.jsonb_text_array(jsonb) reset search_path;
