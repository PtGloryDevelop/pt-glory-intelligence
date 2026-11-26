-- Rollback of 0082: getRivalBoard calls rival_keyword_pages_by_unit, so deploy the previous app build
-- (which asks rival_keyword_pages per unit) before running this.
drop function if exists public.rival_keyword_pages_by_unit(jsonb);
notify pgrst, 'reload schema';
