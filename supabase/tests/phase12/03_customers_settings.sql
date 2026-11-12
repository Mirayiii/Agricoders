-- Prototype customer form and Settings switches (Jac, 5 Nov 2026).
\set ON_ERROR_STOP 1
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if;
end $$;
create function pg_temp.err(uid uuid, sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
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

begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000033a1', 'admin33@meah.test', '{"full_name":"Ana Admin"}'),
  ('00000000-0000-0000-0000-0000000033c1', 'office33@meah.test', '{"full_name":"Liza Office"}'),
  ('00000000-0000-0000-0000-0000000033f1', 'buyer33@meah.test', '{"full_name":"Ben Buyer"}'),
  ('00000000-0000-0000-0000-0000000033d1', 'driver33@meah.test', '{"full_name":"Rico Driver"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000033a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000033c1';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id = '00000000-0000-0000-0000-0000000033f1';
update public.profiles set status = 'active', role = 'delivery_staff' where id = '00000000-0000-0000-0000-0000000033d1';

-- Which switches each role gets, as in the prototype.
select pg_temp.ok(public.settings_switches_for_role('administrator') = array['push', 'delivery', 'stock']
  and public.settings_switches_for_role('administrative_staff') = array['push', 'delivery']
  and public.settings_switches_for_role('fulfillment_staff') = array['push', 'stock']
  and public.settings_switches_for_role('delivery_staff') = array['push', 'delivery'], 'Settings shows the prototype''s switches for each role');

-- Push notifications and Low-stock alerts are "Not available yet": the
-- switch can't be changed, and what was saved is kept.
insert into public.notification_preferences (user_id, push_enabled, low_stock_alerts) values
  ('00000000-0000-0000-0000-0000000033f1', false, false);
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000033f1', $q$select public.set_my_setting('push', true)$q$) = 'Not available yet', 'the push switch can''t be changed until push works');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000033f1', $q$select public.set_my_setting('stock', true)$q$) = 'Not available yet', 'nor the low-stock switch');
select pg_temp.ok((select not push_enabled and not low_stock_alerts from public.notification_preferences where user_id = '00000000-0000-0000-0000-0000000033f1'), 'and the saved choices are kept');
select pg_temp.ok(not public.wants_push('00000000-0000-0000-0000-0000000033f1', 'ready_to_buy') and not public.wants_low_stock_alerts('00000000-0000-0000-0000-0000000033f1'), 'a saved "off" is still respected');

-- Push follows only the Push notifications switch; the hidden per-event choices no longer block it.
insert into public.notification_preferences (user_id, push_new_orders, push_flagged_orders, push_delivery_reminders) values
  ('00000000-0000-0000-0000-0000000033c1', false, false, false);
select pg_temp.ok(public.wants_push('00000000-0000-0000-0000-0000000033c1', 'order_requires_verification')
  and public.wants_push('00000000-0000-0000-0000-0000000033c1', 'upcoming_order'), 'old hidden per-event "off" choices don''t silently block pushes');
select pg_temp.ok((select not push_new_orders from public.notification_preferences where user_id = '00000000-0000-0000-0000-0000000033c1'), 'those old choices are kept as they were');
select pg_temp.ok(public.wants_push('00000000-0000-0000-0000-0000000033a1', 'order_requires_verification'), 'with nothing saved, pushes are on');
select pg_temp.ok(not public.wants_push('00000000-0000-0000-0000-0000000033f1', 'order_requires_verification'), 'a role still only gets pushes for events it receives');

-- Delivery reminders works now, and is independent of the push switch.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000033d1', $q$select public.set_my_setting('delivery', false)$q$) is null, 'a driver turns delivery reminders off');
select pg_temp.ok(not public.wants_delivery_reminders('00000000-0000-0000-0000-0000000033d1') and public.wants_push('00000000-0000-0000-0000-0000000033d1', 'upcoming_delivery'), 'that changes the in-app reminders only, not the push switch');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000033d1', $q$select public.set_my_setting('delivery', true)$q$) is null, 'and turns them back on');
select pg_temp.ok(public.wants_delivery_reminders('00000000-0000-0000-0000-0000000033d1'), 'reminders are back');
select pg_temp.ok(public.wants_delivery_reminders('00000000-0000-0000-0000-0000000033c1'), 'office staff keep reminders on unless they turn them off');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000033f1', $q$select public.set_my_setting('delivery', false)$q$) = 'That switch is not available for your role', 'purchasing staff have no delivery reminders switch');

-- Low-stock alerts: administrator and purchasing only.
select pg_temp.ok(public.wants_low_stock_alerts('00000000-0000-0000-0000-0000000033a1')
  and not public.wants_low_stock_alerts('00000000-0000-0000-0000-0000000033c1'), 'low-stock alerts go to the administrator and purchasing, never office staff');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000033d1', $q$select public.set_my_setting('stock', true)$q$) = 'That switch is not available for your role', 'a driver has no low-stock switch');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000033a1', $q$select public.set_my_setting('delivery', null)$q$) = 'That switch is not available for your role', 'a missing value is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000033a1', $q$update public.notification_preferences set low_stock_alerts = true$q$) like 'permission denied%'
  and pg_temp.err('00000000-0000-0000-0000-0000000033a1', $q$update public.notification_preferences set push_enabled = true$q$) like 'permission denied%', 'the new columns can''t be written directly');
rollback;
