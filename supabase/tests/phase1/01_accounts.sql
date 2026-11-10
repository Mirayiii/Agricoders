-- Phase 1 account rules, on a local database built by run_local.sh.
-- Each check prints PASS or stops with FAIL.
\set ON_ERROR_STOP 1
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if;
end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
end $$;

begin;
-- Fixtures: two admins, one office user, one delivery user.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin.one@meah.test', '{"full_name":"Admin One","username":"admin.one"}'),
  ('00000000-0000-0000-0000-00000000000b', 'admin.two@meah.test', '{"full_name":"Admin Two"}'),
  ('00000000-0000-0000-0000-00000000000c', 'office@meah.test', '{"full_name":"Office"}'),
  ('00000000-0000-0000-0000-00000000000d', 'driver@meah.test', '{"full_name":"Driver"}');
update public.profiles set status = 'active', role = 'administrator' where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-00000000000c';
update public.profiles set status = 'active', role = 'delivery_staff' where id = '00000000-0000-0000-0000-00000000000d';
insert into auth.sessions (user_id) values ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');

select pg_temp.ok((select username from profiles where id = '00000000-0000-0000-0000-00000000000a') = 'admin.one', 'new user gets the username from creation metadata');
select pg_temp.ok((select username from profiles where id = '00000000-0000-0000-0000-00000000000b') ~ '^user_[0-9a-f]{12}$', 'user created without a username gets a valid placeholder');

-- Gate ---------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok(public.has_app_role(array['administrative_staff']::profile_role[]), 'active account passes the gate');
reset role;
update profiles set must_change_password = true, must_change_reason = 'temporary_password', temp_password_expires_at = now() + interval '72 hours' where id = '00000000-0000-0000-0000-00000000000c';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok(not public.has_app_role(array['administrative_staff']::profile_role[]), 'flagged account fails has_app_role');
select pg_temp.ok(not public.is_active_account(), 'flagged account fails is_active_account');
select pg_temp.ok((select count(*) from profiles) = 1, 'flagged account can still read its own profile (to reach Set your password)');
select pg_temp.ok((select count(*) from customers) = 0 and (select count(*) from orders) = 0, 'flagged account reads no business rows');
reset role;

-- An admin with the flag on loses admin rights too.
update profiles set must_change_password = true, must_change_reason = 'temporary_password' where id = '00000000-0000-0000-0000-00000000000b';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok(not public.is_active_administrator(), 'flagged administrator is not an active administrator');
reset role;
update profiles set must_change_password = false, must_change_reason = null where id = '00000000-0000-0000-0000-00000000000b';

-- Column privileges: nobody clears the flag through the REST API.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  begin
    update public.profiles set must_change_password = false where id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'FAIL admin could clear must_change_password directly';
  exception when insufficient_privilege then raise notice 'PASS must_change_password cannot be changed through the API, even by an admin';
  end;
  begin
    update public.profiles set username = 'hacked' where id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'FAIL username changed directly';
  exception when insufficient_privilege then raise notice 'PASS username cannot be changed directly';
  end;
end $$;
update public.profiles set full_name = 'Office Person' where id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select full_name from profiles where id = '00000000-0000-0000-0000-00000000000c') = 'Office Person', 'admin can still edit names');
reset role;

-- Private tables are closed to app users.
set local role authenticated;
do $$ declare t text; begin
  foreach t in array array['login_guard','login_attempts','username_history','mutation_requests','credential_ops'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'FAIL % readable by authenticated', t;
    exception when insufficient_privilege then raise notice 'PASS % is not readable by app users', t;
    end;
  end loop;
end $$;
do $$ begin
  begin
    perform public.reserve_login_attempt('user:x');
    raise exception 'FAIL app user can call reserve_login_attempt';
  exception when insufficient_privilege then raise notice 'PASS lockout functions are service-role only';
  end;
end $$;
reset role;

-- Lockout ---------------------------------------------------------------
select pg_temp.ok((select bool_and(allowed) from (select (reserve_login_attempt('user:t1')).allowed from generate_series(1,5)) s), 'first five attempts are allowed');
select pg_temp.ok(not (select allowed from reserve_login_attempt('user:t1')), 'sixth attempt is refused before any password check');
select record_login_result('user:t1', false) from generate_series(1,5);
select pg_temp.ok((select locked_until > now() + interval '14 minutes' from login_guard where key = 'user:t1'), 'fifth failure locks for 15 minutes');
update login_guard set locked_until = now() - interval '1 second' where key = 'user:t1';
select pg_temp.ok((select allowed from reserve_login_attempt('user:t1')), 'lock lifts by itself after 15 minutes');
select record_login_result('user:t1', true);
select pg_temp.ok((select attempt_count from login_guard where key = 'user:t1') = 0, 'a success resets the counter');
select reserve_login_attempt('user:00000000-0000-0000-0000-00000000000d') from generate_series(1,5);
select record_login_result('user:00000000-0000-0000-0000-00000000000d', false) from generate_series(1,5);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) from get_account_locks()) = 1, 'admin sees the locked account');
select admin_unlock_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) from get_account_locks()) = 0, 'admin unlock works at once');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$ begin
  begin
    perform public.admin_unlock_user('00000000-0000-0000-0000-00000000000d');
    raise exception 'FAIL non-admin unlocked';
  exception when insufficient_privilege then raise notice 'PASS non-admins cannot unlock';
  end;
end $$;
reset role;

-- Deactivation ends sessions --------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set status = 'inactive' where id = '00000000-0000-0000-0000-00000000000d';
reset role;
select pg_temp.ok(not exists (select 1 from auth.sessions where user_id = '00000000-0000-0000-0000-00000000000d'), 'deactivation ends the user''s sessions');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.ok(not public.is_active_account(), 'a deactivated account gets no data, even with a token it still holds');
reset role;
update profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000000d';

-- Last active administrator stays protected.
update profiles set status = 'inactive' where id = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  begin
    update public.profiles set status = 'inactive' where id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL last admin deactivated';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS the last active administrator cannot be deactivated';
  end;
end $$;
update profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000000b';

-- Change versus reset race (task 1.9) ---------------------------------
-- c = office user, currently flagged with a temporary password.
create temp table race as select password_version as v from profiles where id = '00000000-0000-0000-0000-00000000000c';
grant select on race to public;
select pg_temp.ok(acquire_credential_lock('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'staff_change'), 'staff change takes the credential lock');
select pg_temp.ok(not acquire_credential_lock('00000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'admin_reset'), 'admin reset cannot start while the change holds the lock');
-- The staff request stalls past the 30-second lock; the admin reset then runs.
update credential_ops set expires_at = now() - interval '1 second' where user_id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok(acquire_credential_lock('00000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'admin_reset'), 'admin reset takes the lock after it expires');
select begin_password_reset('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c');
select pg_temp.ok(not confirm_password_change_window('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', (select v from race)), 'the stalled change may not set its password after the reset');
select pg_temp.ok(not complete_password_change('00000000-0000-0000-0000-00000000000c', (select v from race)), 'the stalled change cannot clear the flag');
select pg_temp.ok((select must_change_password and must_change_reason = 'temporary_password' from profiles where id = '00000000-0000-0000-0000-00000000000c'), 'the reset''s flag stays on');
select release_credential_lock('00000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222');
-- Reset first, change second: the change noted the old version, so it is refused.
select pg_temp.ok(acquire_credential_lock('00000000-0000-0000-0000-00000000000c', '33333333-3333-3333-3333-333333333333', 'staff_change'), 'a later change can take the lock');
select pg_temp.ok(not confirm_password_change_window('00000000-0000-0000-0000-00000000000c', '33333333-3333-3333-3333-333333333333', (select v from race)), 'a change based on the pre-reset version is refused');
-- A normal change: version noted after the reset.
update race set v = (select password_version from profiles where id = '00000000-0000-0000-0000-00000000000c');
select pg_temp.ok(confirm_password_change_window('00000000-0000-0000-0000-00000000000c', '33333333-3333-3333-3333-333333333333', (select v from race)), 'a change with the current version may proceed');
select pg_temp.ok(complete_password_change('00000000-0000-0000-0000-00000000000c', (select v from race)), 'the staff member''s own change clears the flag');
select pg_temp.ok((select not must_change_password and must_change_reason is null and temp_password_expires_at is null and password_version = (select v from race) + 1 from profiles where id = '00000000-0000-0000-0000-00000000000c'), 'flag, reason and expiry cleared; version raised');
select pg_temp.ok(not complete_password_change('00000000-0000-0000-0000-00000000000c', (select v from race)), 'the same change cannot be replayed');
select release_credential_lock('00000000-0000-0000-0000-00000000000c', '33333333-3333-3333-3333-333333333333');

-- Admin request idempotency ----------------------------------------------
select pg_temp.ok((select state from begin_admin_request('00000000-0000-0000-0000-00000000000a', '44444444-4444-4444-4444-444444444444', 'admin_reset_password', 'h1')) = 'new', 'first call records the request');
select pg_temp.ok((select state from begin_admin_request('00000000-0000-0000-0000-00000000000a', '44444444-4444-4444-4444-444444444444', 'admin_reset_password', 'h1')) = 'pending', 'a retry before it finished continues the same request');
select finish_admin_request('00000000-0000-0000-0000-00000000000a', '44444444-4444-4444-4444-444444444444', '{"ok":true}');
select pg_temp.ok((select result from begin_admin_request('00000000-0000-0000-0000-00000000000a', '44444444-4444-4444-4444-444444444444', 'admin_reset_password', 'h1')) = '{"ok":true}', 'a retry after it finished returns the original result');
do $$ begin
  begin
    perform public.begin_admin_request('00000000-0000-0000-0000-00000000000a', '44444444-4444-4444-4444-444444444444', 'admin_reset_password', 'different');
    raise exception 'FAIL reused request id accepted';
  exception when others then
    if sqlerrm <> 'request_id_reused' then raise; end if;
    raise notice 'PASS a reused request id with different arguments is refused';
  end;
end $$;

-- Usernames ---------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select admin_change_username('00000000-0000-0000-0000-00000000000d', 'Driver.One');
select pg_temp.ok((select username from profiles where id = '00000000-0000-0000-0000-00000000000d') = 'driver.one', 'usernames are stored lowercase');
select admin_change_username('00000000-0000-0000-0000-00000000000d', 'driver.two');
do $$ begin
  begin
    perform public.admin_change_username('00000000-0000-0000-0000-00000000000c', 'driver.one');
    raise exception 'FAIL old name given away';
  exception when others then
    if sqlerrm <> 'username_taken' then raise; end if;
    raise notice 'PASS a renamed account''s old name is reserved for 30 days';
  end;
  begin
    perform public.admin_change_username('00000000-0000-0000-0000-00000000000c', '9bad');
    raise exception 'FAIL invalid username accepted';
  exception when others then
    if sqlerrm <> 'username_taken' then raise; end if;
    raise notice 'PASS invalid usernames are refused';
  end;
end $$;
reset role;
select pg_temp.ok((select count(*) from lookup_sign_in_account('  DRIVER.TWO ')) = 1, 'sign-in lookup is not case-sensitive and ignores spaces');

-- Go-live scripts ---------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'Maria.Santos@meah.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'maria.santos@other.test'),
  ('00000000-0000-0000-0000-0000000000e3', '1st+crew@meah.test'),
  ('00000000-0000-0000-0000-0000000000e4', 'jo@meah.test');
select backfill_usernames();
select pg_temp.ok((select array_agg(username order by id::text) from profiles where id::text like '%e_') = array['maria.santos','maria.santos2','u1stcrew','jo0'], 'backfill makes valid, unique usernames');
select pg_temp.ok((select count(*) from username_migration_report where user_id::text like '%e_') = 4, 'every backfilled name is in the report');
update profiles set must_change_password = true, must_change_reason = 'policy_upgrade', temp_password_expires_at = null where not must_change_password;
select pg_temp.ok((select bool_and(temp_password_expires_at is null) from profiles where must_change_reason = 'policy_upgrade'), 'D11 accounts have no 72-hour expiry');
-- Task 1.1 audit: no function the app can call skips the account gate.
select pg_temp.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
    and p.prosrc !~ '(has_app_role|is_active_administrator|can_read_order|is_active_account)\('
    and p.proname not in ('has_app_role', 'is_active_administrator', 'is_active_account', 'can_read_order')
), 'every app-callable security-definer function checks the account gate');
rollback;
