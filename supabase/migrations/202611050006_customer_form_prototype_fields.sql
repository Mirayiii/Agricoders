-- The customer form follows MEAH-Prototype 2.html: it no longer has Business
-- type, Preferred delivery window or Notes. Values already saved are kept;
-- a save that leaves a field out keeps what is stored (business type and
-- delivery window already did, notes now does too).

create or replace function pg_temp.patch_all(p_function regprocedure, p_from text, p_to text, p_expected int default 1)
returns void language plpgsql as $$
declare
  v_def text := replace(pg_get_functiondef(p_function), E'\r', '');
  v_from text := replace(p_from, E'\r', '');
  v_count int := (length(v_def) - length(replace(v_def, v_from, ''))) / greatest(length(v_from), 1);
begin
  if v_count <> p_expected then
    raise exception 'patch_all: expected % match(es) in %, found % for: %', p_expected, p_function, v_count, p_from;
  end if;
  execute replace(v_def, v_from, replace(p_to, E'\r', ''));
end;
$$;

do $$ begin perform pg_temp.patch_all('public.save_customer(uuid, jsonb, uuid)'::regprocedure,
  '      notes = p_customer->>''notes'',',
  '      notes = case when p_customer ? ''notes'' then p_customer->>''notes'' else v_before.notes end,'); end $$;
