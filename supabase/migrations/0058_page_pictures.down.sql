-- Removes page picture records (stored objects under pages/ stay in the bucket and are harmless).
drop table if exists public.page_pictures;
notify pgrst, 'reload schema';
