-- Date, search and unit filters need estimates for this call's values.
-- A generic plan estimates one candidate and repeatedly scans the daily rows.
alter function public.owned_performance_page(uuid,date,date,text,text,text,text,text,integer)
  set plan_cache_mode = force_custom_plan;
