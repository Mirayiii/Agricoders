-- Phase 1 go-live, step 3: after the report has been reviewed, every account
-- must have a username. Stops without changing anything if one is missing.
do $$
begin
  if exists (select 1 from public.profiles where username is null) then
    raise exception 'Some accounts have no username yet. Run 01_username_backfill.sql first.';
  end if;
end;
$$;
alter table public.profiles alter column username set not null;
