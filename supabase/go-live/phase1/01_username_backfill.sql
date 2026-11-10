-- Phase 1 go-live, step 1: give every account a username (D2).
-- Proposes a name from the part of the email before "@", made valid:
-- lowercase, only a-z 0-9 . _, starts with a letter, 3-30 characters, unique.
-- Every proposal is written to username_migration_report for an admin to check.

create table if not exists public.username_migration_report (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email text not null,
  full_name text,
  proposed_username text not null,
  note text not null,
  created_at timestamptz not null default now()
);
alter table public.username_migration_report enable row level security;
revoke all on table public.username_migration_report from anon, authenticated;
create policy "username_report_administrators" on public.username_migration_report
  for select to authenticated using (public.is_active_administrator());
grant select on table public.username_migration_report to authenticated;

create or replace function public.backfill_usernames()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_base text;
  v_candidate text;
  v_note text;
  v_n integer;
  v_count integer := 0;
begin
  for r in
    select p.id, p.email, p.full_name
    from public.profiles p
    where p.username is null or p.username ~ '^user_[0-9a-f]{12}$'
    order by p.created_at, p.id
  loop
    v_base := regexp_replace(lower(split_part(r.email, '@', 1)), '[^a-z0-9._]', '', 'g');
    v_note := case when v_base = lower(split_part(r.email, '@', 1)) then 'from email' else 'from email, invalid characters removed' end;
    if v_base !~ '^[a-z]' then
      v_base := 'u' || v_base;
      v_note := v_note || ', starts with a letter';
    end if;
    if length(v_base) < 3 then
      v_base := rpad(v_base, 3, '0');
      v_note := v_note || ', padded to 3 characters';
    end if;
    v_base := left(v_base, 30);

    v_candidate := v_base;
    v_n := 1;
    while exists (select 1 from public.profiles where lower(username) = v_candidate and id <> r.id)
       or exists (select 1 from public.username_history where lower(old_username) = v_candidate and reserved_until > now()) loop
      v_n := v_n + 1;
      v_candidate := left(v_base, 30 - length(v_n::text)) || v_n::text;
    end loop;
    if v_n > 1 then
      v_note := v_note || ', number added because the name was taken';
    end if;

    update public.profiles set username = v_candidate where id = r.id;
    insert into public.username_migration_report (user_id, email, full_name, proposed_username, note)
    values (r.id, r.email, r.full_name, v_candidate, v_note)
    on conflict (user_id) do update set proposed_username = excluded.proposed_username, note = excluded.note;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.backfill_usernames() from public, anon, authenticated;

select public.backfill_usernames() as accounts_given_a_username;
