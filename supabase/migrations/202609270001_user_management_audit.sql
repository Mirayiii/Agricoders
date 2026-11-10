-- MEAH user management audit trail.
-- Records administrator actions on personnel accounts: creation, role
-- changes, and activation/deactivation. Apply after the Part 1-9 migrations.

create table public.user_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('user_created', 'role_changed', 'account_activated', 'account_deactivated')),
  actor_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index user_audit_log_target_user_id_idx on public.user_audit_log (target_user_id);
create index user_audit_log_created_at_idx on public.user_audit_log (created_at desc);

alter table public.user_audit_log enable row level security;

revoke all on table public.user_audit_log from anon;
revoke all on table public.user_audit_log from authenticated;

-- Only administrators may review the audit trail. No INSERT/UPDATE/DELETE
-- grants are given to authenticated users: rows are written exclusively by
-- the security-definer trigger below and by the admin-create-user Edge
-- Function's service-role client, both of which bypass RLS by design.
create policy "user_audit_log_select_administrator"
  on public.user_audit_log for select to authenticated
  using (public.is_active_administrator());

-- Logs role and status changes made directly against profiles (role
-- assignment and activation/deactivation from the User Management screen).
-- Skips changes with no authenticated caller (auth.uid() is null) because
-- those come from trusted server code -- the admin-create-user Edge
-- Function -- which already writes its own explicit "user_created" entry.
create function public.log_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role then
    insert into public.user_audit_log (action, actor_id, target_user_id, details)
    values ('role_changed', auth.uid(), new.id, jsonb_build_object('from_role', old.role, 'to_role', new.role));
  end if;

  if new.status is distinct from old.status then
    insert into public.user_audit_log (action, actor_id, target_user_id, details)
    values (
      case when new.status = 'active' then 'account_activated' else 'account_deactivated' end,
      auth.uid(),
      new.id,
      jsonb_build_object('from_status', old.status, 'to_status', new.status)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_audit_role_status_change on public.profiles;
create trigger profiles_audit_role_status_change
  after update of role, status on public.profiles
  for each row execute procedure public.log_profile_change();
