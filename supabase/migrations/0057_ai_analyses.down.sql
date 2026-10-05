-- Removes cached AI readings (re-creatable by running the analysis again, at its cost).
drop table if exists public.ai_analyses;
notify pgrst, 'reload schema';
