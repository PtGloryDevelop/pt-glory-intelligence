-- Rollback: the list page falls back to its previous plain select on datasets.
-- Nothing is stored by 0020, so dropping the function loses no data.
drop function if exists public.dataset_list();
