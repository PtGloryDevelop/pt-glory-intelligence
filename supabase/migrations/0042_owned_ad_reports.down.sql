-- Destructive rollback: removes uploaded company reports. Back up first.
drop table if exists public.owned_ad_reports;
drop function if exists public.owned_ad_report_rows_valid(jsonb);
notify pgrst, 'reload schema';
