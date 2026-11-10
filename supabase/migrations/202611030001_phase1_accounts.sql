-- Phase 1, Migration A: username sign-in and server-side account rules.
--
-- Additive only. Existing accounts keep working exactly as before:
--   * every new profiles column is nullable or defaults to "no change"
--     (must_change_password = false), so the stricter gate below lets every
--     current active account through;
--   * usernames stay empty until the go-live backfill
--     (supabase/go-live/phase1/01_username_backfill.sql) is reviewed and run.
--
-- Do not apply to production before the go-live checklist in the rollout plan
-- (task 1.14): backups first, then this migration.

-- ---------------------------------------------------------------------------
-- 1. Account columns
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists username text,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists must_change_reason text,
  add column if not exists temp_password_expires_at timestamptz,
  add column if not exists contact_email text,
  add column if not exists password_version integer not null default 0;

-- D2: 3-30 characters, lowercase letters, digits, dot and underscore, starting
-- with a letter. Usernames are stored lowercase, so sign-in is not case-sensitive.
alter table public.profiles
  add constraint profiles_username_format
    check (username is null or username ~ '^[a-z][a-z0-9._]{2,29}$'),
  add constraint profiles_must_change_reason_valid
    check (must_change_reason is null or must_change_reason in ('temporary_password', 'policy_upgrade')),
  add constraint profiles_must_change_has_reason
    check (not must_change_password or must_change_reason is not null);

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username)) where username is not null;

-- Nobody edits account-state columns through the REST API. Administrators can
-- still change name, role and status from the app; everything else goes
-- through the functions below or the Edge Functions (service role).
revoke update on table public.profiles from authenticated;
grant update (full_name, role, status) on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Private tables (service role and security-definer functions only)
-- ---------------------------------------------------------------------------

-- One row per account ("user:<id>") or per IP for unknown usernames ("ip:<addr>").
create table if not exists public.login_guard (
  key text primary key,
  attempt_count integer not null default 0,
  locked_until timestamptz,
  last_attempt_at timestamptz
);

create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  username_attempted text,
  user_id uuid references public.profiles(id) on delete set null,
  ip_address text,
  result text not null,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_user_created_idx on public.login_attempts (user_id, created_at desc);

create table if not exists public.username_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  old_username text not null,
  new_username text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  -- D3: the old name cannot be given to anyone else until this time.
  reserved_until timestamptz not null
);
create index if not exists username_history_old_lower_idx on public.username_history (lower(old_username), reserved_until);

-- A short lock so two credential changes for one account never interleave
-- (staff change, admin reset, admin create). Expires on its own after 30 s.
create table if not exists public.credential_ops (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  holder uuid not null,
  operation text not null,
  expires_at timestamptz not null
);

-- Idempotency for admin functions: a retry with the same request id returns the
-- original result instead of doing the work twice.
create table if not exists public.mutation_requests (
  user_id uuid not null,
  request_id uuid not null,
  rpc_name text not null,
  args_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'done')),
  target_user_id uuid,
  details jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, request_id)
);

alter table public.login_guard enable row level security;
alter table public.login_attempts enable row level security;
alter table public.username_history enable row level security;
alter table public.credential_ops enable row level security;
alter table public.mutation_requests enable row level security;

revoke all on table public.login_guard, public.login_attempts, public.username_history,
  public.credential_ops, public.mutation_requests from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The gate: an account gets data only while active and not waiting to
--    change its password. Checked on every request, so a session is never
--    worth more than the account behind it.
-- ---------------------------------------------------------------------------

create or replace function public.is_active_account()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and not must_change_password
  );
$$;
revoke all on function public.is_active_account() from public;
grant execute on function public.is_active_account() to authenticated;

create or replace function public.has_app_role(allowed_roles public.profile_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'active'
      and not must_change_password
      and role = any(allowed_roles)
  );
$$;

create or replace function public.is_active_administrator()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'administrator'
      and status = 'active'
      and not must_change_password
  );
$$;

-- Audit gaps (task 1.1): these checked only ownership, not account state.
drop policy if exists "users_read_own_notifications" on public.notifications;
create policy "users_read_own_notifications" on public.notifications
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_account());

drop policy if exists "users_mark_own_notifications_read" on public.notifications;
create policy "users_mark_own_notifications_read" on public.notifications
  for update to authenticated
  using (user_id = auth.uid() and public.is_active_account())
  with check (user_id = auth.uid() and public.is_active_account());

-- Callable by any signed-in user before; now only by active accounts. The
-- scheduled job (no auth.uid()) still runs it.
create or replace function public.generate_upcoming_notifications()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_active_account() then
    raise exception 'Your account cannot do this right now' using errcode = '42501';
  end if;

  insert into public.notifications(user_id, type, title, message, related_order_id, event_key)
  select p.id, 'upcoming_order', 'Upcoming order', o.order_number || ' is scheduled for ' || o.requested_delivery_date::text, o.id, 'upcoming_order:' || o.id::text || ':' || o.requested_delivery_date::text
  from public.orders o cross join public.profiles p
  where o.requested_delivery_date between current_date and current_date + 1
    and o.status not in ('completed', 'cancelled')
    and p.role in ('administrator', 'administrative_staff') and p.status = 'active'
  on conflict (user_id, event_key) do nothing;

  insert into public.notifications(user_id, type, title, message, related_order_id, event_key)
  select recipient.id, 'upcoming_delivery', 'Upcoming delivery', o.order_number || ' delivery is scheduled for ' || d.scheduled_date::text, o.id, 'upcoming_delivery:' || d.id::text || ':' || d.scheduled_date::text
  from public.deliveries d join public.orders o on o.id = d.order_id
  join public.profiles recipient on recipient.status = 'active'
  where d.scheduled_date between current_date and current_date + 1
    and d.status in ('scheduled', 'for_delivery')
    and (recipient.role in ('administrator', 'administrative_staff') or recipient.id = d.assigned_driver_id)
  on conflict (user_id, event_key) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Deactivation ends the account's sessions at once, so they cannot be
--    refreshed; the gate above already blocks data on the very next request.
--    (The Auth user is not banned: Supabase checks a ban before the password,
--    which would let anyone learn that an account is deactivated without
--    knowing its password. staff-sign-in reports "deactivated" only after the
--    password is correct.)
-- ---------------------------------------------------------------------------

create or replace function public.end_sessions_on_deactivation()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  delete from auth.sessions where user_id = new.id;
  return new;
end;
$$;
revoke all on function public.end_sessions_on_deactivation() from public;

drop trigger if exists profiles_end_sessions_on_deactivation on public.profiles;
create trigger profiles_end_sessions_on_deactivation
  after update of status on public.profiles
  for each row
  when (old.status = 'active' and new.status = 'inactive')
  execute procedure public.end_sessions_on_deactivation();

-- ---------------------------------------------------------------------------
-- 5. Lockout (task 1.4): count first, check second. Service role only.
-- ---------------------------------------------------------------------------

-- Returns allowed = false without touching the password when the key already
-- has 5 attempts in flight or failed. The row lock makes parallel requests
-- queue, so at most 5 ever reach Supabase Auth.
create or replace function public.reserve_login_attempt(p_key text)
returns table(allowed boolean, locked_until timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.login_guard;
begin
  insert into public.login_guard (key) values (p_key) on conflict (key) do nothing;
  select * into v_row from public.login_guard g where g.key = p_key for update;

  -- D4: unlock automatically 15 minutes after the lock (or after the last
  -- attempt, if a crashed request never reported its result).
  if (v_row.locked_until is not null and v_row.locked_until <= now())
     or (v_row.locked_until is null and v_row.attempt_count >= 5
         and v_row.last_attempt_at <= now() - interval '15 minutes') then
    v_row.attempt_count := 0;
    v_row.locked_until := null;
  end if;

  if v_row.locked_until is not null or v_row.attempt_count >= 5 then
    update public.login_guard g
      set attempt_count = v_row.attempt_count, locked_until = v_row.locked_until
      where g.key = p_key;
    return query select false, coalesce(v_row.locked_until, v_row.last_attempt_at + interval '15 minutes');
    return;
  end if;

  update public.login_guard g
    set attempt_count = v_row.attempt_count + 1, locked_until = null, last_attempt_at = now()
    where g.key = p_key;
  return query select true, null::timestamptz;
end;
$$;

-- A success clears the counter. A failure keeps the attempt counted, and the
-- 5th counted attempt locks the key for 15 minutes.
create or replace function public.record_login_result(
  p_key text, p_success boolean, p_user_id uuid default null,
  p_username text default null, p_ip text default null, p_result text default null)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_locked timestamptz;
begin
  if p_success then
    update public.login_guard set attempt_count = 0, locked_until = null where key = p_key;
  else
    update public.login_guard
      set locked_until = case when attempt_count >= 5 then now() + interval '15 minutes' else locked_until end
      where key = p_key
      returning locked_until into v_locked;
  end if;

  insert into public.login_attempts (username_attempted, user_id, ip_address, result)
  values (p_username, p_user_id, p_ip, coalesce(p_result, case when p_success then 'ok' else 'invalid' end));
  return v_locked;
end;
$$;

-- Administrators unlock an account at once (D4).
create or replace function public.admin_unlock_user(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_active_administrator() then
    raise exception 'Only administrators can unlock accounts' using errcode = '42501';
  end if;
  delete from public.login_guard where key = 'user:' || p_user_id::text;
  insert into public.user_audit_log (action, actor_id, target_user_id, details)
  values ('account_unlocked', auth.uid(), p_user_id, '{}'::jsonb);
end;
$$;

-- Whether an account is locked right now, for the admin screen.
create or replace function public.get_account_locks()
returns table(user_id uuid, locked_until timestamptz)
language sql stable security definer set search_path = public
as $$
  select substr(g.key, 6)::uuid,
         coalesce(g.locked_until, g.last_attempt_at + interval '15 minutes')
  from public.login_guard g
  where public.is_active_administrator()
    and g.key like 'user:%'
    and (g.locked_until > now()
         or (g.locked_until is null and g.attempt_count >= 5 and g.last_attempt_at > now() - interval '15 minutes'));
$$;

-- ---------------------------------------------------------------------------
-- 6. Sign-in lookups (service role only)
-- ---------------------------------------------------------------------------

create or replace function public.lookup_sign_in_account(p_username text)
returns table(
  user_id uuid, email text, full_name text, role public.profile_role,
  status public.account_status, must_change_password boolean, must_change_reason text,
  temp_password_expires_at timestamptz, password_version integer)
language sql stable security definer set search_path = public
as $$
  select p.id, u.email, p.full_name, p.role, p.status, p.must_change_password,
         p.must_change_reason, p.temp_password_expires_at, p.password_version
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = lower(trim(p_username));
$$;

create or replace function public.lookup_account_by_id(p_user_id uuid)
returns table(
  user_id uuid, email text, full_name text, role public.profile_role,
  status public.account_status, must_change_password boolean, must_change_reason text,
  temp_password_expires_at timestamptz, password_version integer)
language sql stable security definer set search_path = public
as $$
  select p.id, u.email, p.full_name, p.role, p.status, p.must_change_password,
         p.must_change_reason, p.temp_password_expires_at, p.password_version
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_user_id;
$$;

-- Ends a user's sessions, optionally keeping one (the caller's own).
create or replace function public.revoke_user_sessions(p_user_id uuid, p_keep_session uuid default null)
returns void
language sql security definer set search_path = public, auth
as $$
  delete from auth.sessions
  where user_id = p_user_id and (p_keep_session is null or id <> p_keep_session);
$$;

-- ---------------------------------------------------------------------------
-- 7. Credential changes and the change-versus-reset race (task 1.9)
-- ---------------------------------------------------------------------------

-- Takes the per-account credential lock, or returns false if someone else holds
-- a lock that has not expired. Holding it again with the same holder renews it.
create or replace function public.acquire_credential_lock(p_user_id uuid, p_holder uuid, p_operation text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_holder uuid;
begin
  insert into public.credential_ops as c (user_id, holder, operation, expires_at)
  values (p_user_id, p_holder, p_operation, now() + interval '30 seconds')
  on conflict (user_id) do update
    set holder = excluded.holder, operation = excluded.operation, expires_at = excluded.expires_at
    where c.expires_at <= now() or c.holder = excluded.holder
  returning holder into v_holder;
  return v_holder is not null;
end;
$$;

create or replace function public.release_credential_lock(p_user_id uuid, p_holder uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from public.credential_ops where user_id = p_user_id and holder = p_holder;
$$;

-- Called by staff-change-password right before it sets the new password in
-- Supabase Auth: succeeds only while the caller still holds the lock and no
-- reset has happened since the current password was checked.
create or replace function public.confirm_password_change_window(p_user_id uuid, p_holder uuid, p_noted_version integer)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.credential_ops
    set expires_at = now() + interval '30 seconds'
    where user_id = p_user_id and holder = p_holder and expires_at > now();
  if not found then
    return false;
  end if;
  select exists (
    select 1 from public.profiles
    where id = p_user_id and password_version = p_noted_version and status = 'active'
  ) into v_ok;
  return v_ok;
end;
$$;

-- The only code that clears must_change_password. It clears it only if no
-- credential change happened since staff-change-password noted the version,
-- and raises the version in the same statement. An admin reset raises the
-- version too, so a change that started before a reset can never clear the
-- reset's flag.
create or replace function public.complete_password_change(p_user_id uuid, p_noted_version integer)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
    set must_change_password = false,
        must_change_reason = null,
        temp_password_expires_at = null,
        password_version = password_version + 1
    where id = p_user_id and password_version = p_noted_version;
  if not found then
    return false;
  end if;
  insert into public.user_audit_log (action, actor_id, target_user_id, details)
  values ('password_changed', p_user_id, p_user_id, '{}'::jsonb);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Admin requests: record intent first, then the Auth step, then done.
-- ---------------------------------------------------------------------------

-- Returns the request's state: 'new' (row just written), 'pending' (an earlier
-- attempt stopped part-way; continue it) or 'done' (return the stored result).
-- A reused request id with different arguments is refused.
create or replace function public.begin_admin_request(
  p_actor uuid, p_request_id uuid, p_rpc_name text, p_args_hash text,
  p_target_user_id uuid default null, p_details jsonb default '{}'::jsonb)
returns table(state text, target_user_id uuid, details jsonb, result jsonb)
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.mutation_requests;
begin
  insert into public.mutation_requests (user_id, request_id, rpc_name, args_hash, target_user_id, details)
  values (p_actor, p_request_id, p_rpc_name, p_args_hash, p_target_user_id, coalesce(p_details, '{}'::jsonb))
  on conflict (user_id, request_id) do nothing;
  if found then
    return query select 'new'::text, p_target_user_id, coalesce(p_details, '{}'::jsonb), null::jsonb;
    return;
  end if;

  select * into v_row from public.mutation_requests m
    where m.user_id = p_actor and m.request_id = p_request_id for update;
  if v_row.rpc_name <> p_rpc_name or v_row.args_hash <> p_args_hash then
    raise exception 'request_id_reused' using errcode = 'P0001';
  end if;
  return query select v_row.status, v_row.target_user_id, v_row.details, v_row.result;
end;
$$;

create or replace function public.finish_admin_request(p_actor uuid, p_request_id uuid, p_result jsonb)
returns void
language sql security definer set search_path = public
as $$
  update public.mutation_requests
    set status = 'done', result = p_result, completed_at = now()
    where user_id = p_actor and request_id = p_request_id;
$$;

create or replace function public.set_admin_request_target(p_actor uuid, p_request_id uuid, p_target uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.mutation_requests set target_user_id = p_target
    where user_id = p_actor and request_id = p_request_id;
$$;

-- Whether a username can be given to a new or renamed account: unused, not
-- reserved by a rename in the last 30 days, and not held by a pending create.
create or replace function public.username_available(p_username text, p_except_request uuid default null)
returns boolean
language sql stable security definer set search_path = public
as $$
  select lower(trim(p_username)) ~ '^[a-z][a-z0-9._]{2,29}$'
    and not exists (select 1 from public.profiles where lower(username) = lower(trim(p_username)))
    and not exists (select 1 from public.username_history
                    where lower(old_username) = lower(trim(p_username)) and reserved_until > now())
    and not exists (select 1 from public.mutation_requests
                    where rpc_name = 'admin_create_user' and status = 'pending'
                      and request_id is distinct from p_except_request
                      and created_at > now() - interval '1 day'
                      and lower(details ->> 'username') = lower(trim(p_username)));
$$;

-- Admin reset, step 1 (committed before the Auth step): flag on, 72-hour
-- expiry (D6), version raised, sessions lose data access at once.
create or replace function public.begin_password_reset(p_actor uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
    set must_change_password = true,
        must_change_reason = 'temporary_password',
        temp_password_expires_at = now() + interval '72 hours',
        password_version = password_version + 1
    where id = p_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  insert into public.user_audit_log (action, actor_id, target_user_id, details)
  values ('password_reset', p_actor, p_user_id, '{}'::jsonb);
end;
$$;

-- Admin create, final step: give the new Auth user its role, name and a
-- temporary-password flag. Safe to run again for the same request.
create or replace function public.finish_create_user(
  p_actor uuid, p_request_id uuid, p_user_id uuid, p_username text, p_full_name text,
  p_role public.profile_role, p_contact_email text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_existing text;
begin
  select username into v_existing from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if v_existing is null or lower(v_existing) <> lower(trim(p_username)) then
    if not public.username_available(p_username, p_request_id) then
      raise exception 'username_taken' using errcode = 'P0001';
    end if;
  end if;
  update public.profiles
    set username = lower(trim(p_username)),
        full_name = p_full_name,
        role = p_role,
        status = 'active',
        contact_email = nullif(lower(trim(coalesce(p_contact_email, ''))), ''),
        must_change_password = true,
        must_change_reason = 'temporary_password',
        temp_password_expires_at = now() + interval '72 hours'
    where id = p_user_id;
  if not exists (select 1 from public.user_audit_log where action = 'user_created' and target_user_id = p_user_id) then
    insert into public.user_audit_log (action, actor_id, target_user_id, details)
    values ('user_created', p_actor, p_user_id,
            jsonb_build_object('username', lower(trim(p_username)), 'role', p_role, 'full_name', p_full_name));
  end if;
end;
$$;

-- New Auth users get their username from the creating function's metadata,
-- in the same statement that creates them. Users created any other way (for
-- example the Supabase dashboard) get a placeholder an admin can rename.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_username text := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
begin
  if v_username !~ '^[a-z][a-z0-9._]{2,29}$' then
    v_username := 'user_' || substr(md5(new.id::text), 1, 12);
  end if;
  insert into public.profiles (id, full_name, email, username)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    lower(new.email),
    v_username
  );
  return new;
end;
$$;

-- Finds the Auth user a crashed create already made (its email is fixed by the request id).
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

-- Renames keep the account's id, so lockout, sessions and history stay (D3).
create or replace function public.admin_change_username(p_user_id uuid, p_new_username text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_old text;
  v_new text := lower(trim(p_new_username));
begin
  if not public.is_active_administrator() then
    raise exception 'Only administrators can change usernames' using errcode = '42501';
  end if;
  select username into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if v_old is not null and lower(v_old) = v_new then
    return;
  end if;
  if not public.username_available(v_new) then
    raise exception 'username_taken' using errcode = 'P0001';
  end if;
  update public.profiles set username = v_new where id = p_user_id;
  if v_old is not null then
    insert into public.username_history (user_id, old_username, new_username, changed_by, reserved_until)
    values (p_user_id, v_old, v_new, auth.uid(), now() + interval '30 days');
  end if;
  insert into public.user_audit_log (action, actor_id, target_user_id, details)
  values ('username_changed', auth.uid(), p_user_id, jsonb_build_object('from', v_old, 'to', v_new));
end;
$$;

-- The audit log gains the new account actions.
alter table public.user_audit_log drop constraint if exists user_audit_log_action_check;
alter table public.user_audit_log add constraint user_audit_log_action_check check (action in (
  'user_created', 'role_changed', 'account_activated', 'account_deactivated',
  'password_reset', 'password_changed', 'account_unlocked', 'username_changed'));

-- ---------------------------------------------------------------------------
-- 9. Who may call what
-- ---------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.reserve_login_attempt(text)',
    'public.record_login_result(text, boolean, uuid, text, text, text)',
    'public.lookup_sign_in_account(text)',
    'public.lookup_account_by_id(uuid)',
    'public.revoke_user_sessions(uuid, uuid)',
    'public.acquire_credential_lock(uuid, uuid, text)',
    'public.release_credential_lock(uuid, uuid)',
    'public.confirm_password_change_window(uuid, uuid, integer)',
    'public.complete_password_change(uuid, integer)',
    'public.begin_admin_request(uuid, uuid, text, text, uuid, jsonb)',
    'public.finish_admin_request(uuid, uuid, jsonb)',
    'public.set_admin_request_target(uuid, uuid, uuid)',
    'public.username_available(text, uuid)',
    'public.begin_password_reset(uuid, uuid)',
    'public.finish_create_user(uuid, uuid, uuid, text, text, public.profile_role, text)',
    'public.auth_user_id_by_email(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

revoke all on function public.admin_unlock_user(uuid) from public, anon;
grant execute on function public.admin_unlock_user(uuid) to authenticated;
revoke all on function public.get_account_locks() from public, anon;
grant execute on function public.get_account_locks() to authenticated;
revoke all on function public.admin_change_username(uuid, text) from public, anon;
grant execute on function public.admin_change_username(uuid, text) to authenticated;

-- Task 1.1 audit: every function the app can call checks the caller with
-- has_app_role(), is_active_administrator(), can_read_order() or
-- is_active_account(), except these two older helpers. Supabase grants new
-- functions to anon and authenticated directly, so "revoke ... from public"
-- in their migrations did not close them. They are only used inside other
-- functions and triggers.
revoke all on function public.notify_administrators(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.validate_delivery_driver(uuid) from public, anon, authenticated;
