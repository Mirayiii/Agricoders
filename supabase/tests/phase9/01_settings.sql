-- Phase 9 settings: notification preferences and delivery reminders.
\set ON_ERROR_STOP 1
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if;
end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
end $$;
create function pg_temp.err(uid uuid, sql text) returns text language plpgsql as $$
begin
  perform pg_temp.as_user(uid);
  set local role authenticated;
  begin
    execute sql;
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return null;
end $$;
create function pg_temp.err_owner(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.run(uid uuid, sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_user(uid);
  set local role authenticated;
  execute sql into v;
  reset role;
  return v;
end $$;

begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a1', 'admin9@meah.test', '{"full_name":"Ana Mercado"}'),
  ('00000000-0000-0000-0000-0000000009c1', 'office9@meah.test', '{"full_name":"Liza Office"}'),
  ('00000000-0000-0000-0000-0000000009d1', 'driver9@meah.test', '{"full_name":"Rico Driver"}'),
  ('00000000-0000-0000-0000-0000000009d2', 'driver9b@meah.test', '{"full_name":"Jun Driver"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000009a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000009c1';
update public.profiles set status = 'active', role = 'delivery_staff' where id in ('00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009d2');
insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-0000000009c0', 'P9-001', 'Casa Verde');
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009c0', 'phone', '00000000-0000-0000-0000-0000000009c1', 'confirmed', current_date + 1);
insert into public.deliveries (id, order_id, assigned_driver_id, scheduled_date) values
  ('00000000-0000-0000-0000-0000000009f1', '00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009d1', current_date + 1);

-- Each person reads and writes only their own preferences.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009c1', $q$insert into public.notification_preferences (user_id, delivery_reminders) values ('00000000-0000-0000-0000-0000000009c1', false)$q$) is null, 'runs: office staff turns delivery reminders off');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009d1', $q$insert into public.notification_preferences (user_id, delivery_reminders) values ('00000000-0000-0000-0000-0000000009c1', true)$q$) like '%row-level security%', 'nobody can save someone else''s preferences');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000009d1', $q$select to_jsonb(count(*)) from public.notification_preferences$q$))::int = 0, 'nobody can read someone else''s preferences');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009d2', $q$insert into public.notification_preferences (user_id, delivery_reminders) values ('00000000-0000-0000-0000-0000000009d2', false)$q$) is null, 'runs: second driver turns reminders off');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009d2', $q$update public.notification_preferences set delivery_reminders = true where user_id = '00000000-0000-0000-0000-0000000009d2'$q$) is null, 'runs: second driver turns reminders back on');
select pg_temp.ok((select delivery_reminders from public.notification_preferences where user_id = '00000000-0000-0000-0000-0000000009d2'), 'a preference can be changed again');
select pg_temp.ok(pg_temp.run('00000000-0000-0000-0000-0000000009a1', 'select public.set_my_notification_preferences(false)') = '{"delivery_reminders": false}', 'runs: the app saves a preference');
select pg_temp.ok(pg_temp.run('00000000-0000-0000-0000-0000000009a1', 'select public.set_my_notification_preferences(true)') = '{"delivery_reminders": true}'
  and (select count(*) from public.notification_preferences where user_id = '00000000-0000-0000-0000-0000000009a1') = 1, 'saving again updates the one row');

-- Reminders follow the preference. No saved row means reminders stay on.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009d1', 'select public.generate_upcoming_notifications()') is null, 'runs: reminders generated');
select pg_temp.ok(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000009a1' and type = 'upcoming_order' and related_order_id = '00000000-0000-0000-0000-0000000009e1')
  and exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000009d1' and type = 'upcoming_delivery'),
  'people with no saved preference still get reminders');
select pg_temp.ok(not exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000009c1' and type in ('upcoming_order', 'upcoming_delivery') and related_order_id = '00000000-0000-0000-0000-0000000009e1'),
  'someone who turned delivery reminders off gets none');

-- A deactivated account can't change preferences.
update public.profiles set status = 'inactive' where id = '00000000-0000-0000-0000-0000000009d1';
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009d1', $q$insert into public.notification_preferences (user_id, delivery_reminders) values ('00000000-0000-0000-0000-0000000009d1', false)$q$) is not null, 'a deactivated account can''t save preferences');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.wants_delivery_reminders(uuid)', 'execute'), 'the preference lookup is not callable from the app');
rollback;
