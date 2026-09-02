-- Set-at-a-time inserts pass array-valued columns as jsonb, because unnest()
-- flattens a text[][] parameter into scalars and cannot feed a text[] column.
-- This rebuilds one text[] per row.
create function public.jsonb_text_array(value jsonb) returns text[]
  language sql immutable parallel safe as $$
    select case
      when value is null or jsonb_typeof(value) <> 'array' then '{}'::text[]
      else coalesce(
        (select array_agg(item order by ordinality)
           from jsonb_array_elements_text(value) with ordinality as t(item, ordinality)),
        '{}'::text[])
    end
  $$;
