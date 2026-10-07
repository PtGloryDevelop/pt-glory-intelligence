-- Removes the Command Center function (0062).
drop function if exists public.owned_command_center(uuid,date,date,text,text);
notify pgrst,'reload schema';
