-- Phase 3 order money rules (D-O1, D-O2), on a local database built by run_local.sh.
\set ON_ERROR_STOP 1
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if;
end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
end $$;
-- Runs sql as the given user and returns the error message, or null if it worked.
create function pg_temp.run(uid uuid, sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  set local role authenticated;
  execute sql into v;
  reset role;
  return v;
end $$;
create function pg_temp.err_owner(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
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

-- Phase 6: routes, driver assignment, confirming deliveries and receipts.
begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@meah.test', '{"full_name":"Ana Admin"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'office@meah.test', '{"full_name":"Liza Office"}'),
  ('00000000-0000-0000-0000-0000000000f1', 'purchasing@meah.test', '{"full_name":"Pia Purchasing"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'rico@meah.test', '{"full_name":"Rico Bautista"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'jun@meah.test', '{"full_name":"Jun Villanueva"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id = '00000000-0000-0000-0000-0000000000f1';
update public.profiles set status = 'active', role = 'delivery_staff' where id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2');

insert into public.customers (id, customer_code, business_name, delivery_address) values
  ('00000000-0000-0000-0000-00000000c001', 'C-001', 'Casa Verde Restaurant', '12 Mabini St., Makati'),
  ('00000000-0000-0000-0000-00000000c002', 'C-002', 'Kusina ni Maria', '3 Aguinaldo Hwy., Imus');
insert into public.products (id, product_name, unit_of_measurement) values ('00000000-0000-0000-0000-00000000b001', 'Tomatoes', 'kg'), ('00000000-0000-0000-0000-00000000b002', 'Cabbage', 'head');

-- Four orders packed and waiting, one still packing, one cancelled.
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'for_delivery', current_date),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c002', 'phone', '00000000-0000-0000-0000-0000000000c1', 'for_delivery', current_date),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'for_delivery', current_date),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000c002', 'phone', '00000000-0000-0000-0000-0000000000c1', 'for_delivery', current_date),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'for_preparation', current_date),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'for_verification', current_date);
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price)
select o, '00000000-0000-0000-0000-00000000b001', 2.5, 'kg', 85, 85, 60 from unnest(array[
  '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e3',
  '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e6']::uuid[]) o;
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000b002', 3, 'head', 60, 60, 40);
-- Rico has e1 and e2 today; e3 is unassigned; e4 is Jun's.
insert into public.deliveries (id, order_id, assigned_driver_id, scheduled_date, scheduled_time) values
  ('00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', current_date, '10:30'),
  ('00000000-0000-0000-0000-0000000001d2', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', current_date, null),
  ('00000000-0000-0000-0000-0000000001d3', '00000000-0000-0000-0000-0000000000e3', null, current_date, null),
  ('00000000-0000-0000-0000-0000000001d4', '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d2', current_date, null);

create temp table t (name text primary key, value jsonb) on commit drop;
grant all on t to authenticated;

-- ---------------------------------------------------------------------------
-- Route order
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.reorder_route(current_date, '00000000-0000-0000-0000-0000000000d1', array['00000000-0000-0000-0000-0000000001d2', '00000000-0000-0000-0000-0000000001d1']::uuid[], gen_random_uuid())$q$) is null, 'a driver reorders their own route');
select pg_temp.ok((select array_agg(id order by route_position) from public.deliveries where assigned_driver_id = '00000000-0000-0000-0000-0000000000d1') = array['00000000-0000-0000-0000-0000000001d2', '00000000-0000-0000-0000-0000000001d1']::uuid[], 'the new order is saved');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.reorder_route(current_date, '00000000-0000-0000-0000-0000000000d2', array['00000000-0000-0000-0000-0000000001d4']::uuid[], gen_random_uuid())$q$) = 'You can only reorder your own stops', 'a driver cannot reorder another driver''s route');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.reorder_route(current_date, null, array['00000000-0000-0000-0000-0000000001d3']::uuid[], gen_random_uuid())$q$) = 'You can only reorder your own stops', 'a driver cannot reorder unassigned stops');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.reorder_route(current_date, null, array['00000000-0000-0000-0000-0000000001d3']::uuid[], gen_random_uuid())$q$) like 'You do not have permission%', 'purchasing staff cannot change routes');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.reorder_route(current_date, '00000000-0000-0000-0000-0000000000d1', array['00000000-0000-0000-0000-0000000001d1']::uuid[], gen_random_uuid())$q$) like 'This route changed while you were editing%', 'a list missing a stop is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.reorder_route(current_date, '00000000-0000-0000-0000-0000000000d1', array['00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001d2', '00000000-0000-0000-0000-0000000001d4']::uuid[], gen_random_uuid())$q$) like 'This route changed while you were editing%', 'a list with another route''s stop is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.reorder_route(current_date, '00000000-0000-0000-0000-0000000000d1', array['00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001d1']::uuid[], gen_random_uuid())$q$) = 'A stop is listed twice', 'a stop cannot be listed twice');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.reorder_route(current_date, '00000000-0000-0000-0000-0000000000d1', array['00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001d2']::uuid[], gen_random_uuid())$q$) is null, 'office staff reorder any route');
select pg_temp.ok((select route_position from public.deliveries where id = '00000000-0000-0000-0000-0000000001d1') = 1, 'office staff''s order is saved');

-- ---------------------------------------------------------------------------
-- Assigning drivers
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.assign_delivery_driver('00000000-0000-0000-0000-0000000001d3', '00000000-0000-0000-0000-0000000000d1', gen_random_uuid())$q$) like 'Only administrators and administrative staff%', 'drivers cannot assign stops, even to themselves');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.assign_delivery_driver('00000000-0000-0000-0000-0000000001d3', '00000000-0000-0000-0000-0000000000f1', gen_random_uuid())$q$) like 'Assigned driver must be%', 'only active delivery staff can be assigned');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
insert into t values ('assign', public.assign_delivery_driver('00000000-0000-0000-0000-0000000001d3', '00000000-0000-0000-0000-0000000000d1', '55555555-5555-4555-8555-555555555551'));
insert into t values ('assignagain', public.assign_delivery_driver('00000000-0000-0000-0000-0000000001d3', '00000000-0000-0000-0000-0000000000d1', '55555555-5555-4555-8555-555555555551'));
reset role;
select pg_temp.ok((select assigned_driver_id = '00000000-0000-0000-0000-0000000000d1' and route_position = 3 from public.deliveries where id = '00000000-0000-0000-0000-0000000001d3'), 'the stop joins the end of the driver''s route (stop 3)');
select pg_temp.ok((select (value->>'replayed')::boolean from t where name = 'assignagain') and (select count(*) from public.order_activity where action = 'driver_assigned') = 1, 'a retried assignment is done and logged once');
-- Reassign to Jun (admin), then take the driver off.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.assign_delivery_driver('00000000-0000-0000-0000-0000000001d3', '00000000-0000-0000-0000-0000000000d2', gen_random_uuid())$q$) is null, 'administrators reassign drivers');
select pg_temp.ok((select assigned_driver_id = '00000000-0000-0000-0000-0000000000d2' and route_position = 2 from public.deliveries where id = '00000000-0000-0000-0000-0000000001d3'), 'reassigned: it is stop 2 on Jun''s route');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000001d3', null, gen_random_uuid())$q$) = 'You can only confirm your own stops', 'after reassignment, Rico can no longer confirm the stop');

-- Drivers list.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
insert into t select 'drivers', jsonb_agg(to_jsonb(x)) from public.get_delivery_drivers(current_date) x;
reset role;
select pg_temp.ok((select value from t where name = 'drivers') @> '[{"full_name":"Rico Bautista","open_stops":2},{"full_name":"Jun Villanueva","open_stops":2}]'::jsonb and jsonb_array_length((select value from t where name = 'drivers')) = 2, 'drivers list shows active delivery staff with today''s stops');

-- ---------------------------------------------------------------------------
-- Confirming deliveries
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d2', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000001d1', null, gen_random_uuid())$q$) = 'You can only confirm your own stops', 'a driver cannot confirm another driver''s stop');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000001d1', null, gen_random_uuid())$q$) like 'Only delivery staff and administrators%', 'purchasing staff cannot confirm deliveries');
-- Requirement DE-04: administrative staff dispatch but don't complete deliveries.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000001d4', null, gen_random_uuid())$q$) = 'Only delivery staff and administrators can mark deliveries delivered', 'administrative staff cannot mark a delivery delivered (DE-04)');
update public.deliveries set status = 'for_delivery' where id = '00000000-0000-0000-0000-0000000001d4';
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.update_delivery_status('00000000-0000-0000-0000-0000000001d4', 'completed', null)$q$) = 'Only delivery staff and administrators can mark deliveries delivered', 'nor through the general delivery status action (DE-04)');
select pg_temp.ok((select status = 'for_delivery' from public.deliveries where id = '00000000-0000-0000-0000-0000000001d4'), 'the stop stays open');
update public.deliveries set status = 'scheduled' where id = '00000000-0000-0000-0000-0000000001d4';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
insert into t values ('done', public.complete_delivery('00000000-0000-0000-0000-0000000001d1', '  Mark   Reyes ', '66666666-6666-4666-8666-666666666661'));
insert into t values ('doneagain', public.complete_delivery('00000000-0000-0000-0000-0000000001d1', '  Mark   Reyes ', '66666666-6666-4666-8666-666666666661'));
reset role;
select pg_temp.ok((select status = 'completed' and completed_at is not null and received_by = 'Mark Reyes' from public.deliveries where id = '00000000-0000-0000-0000-0000000001d1'), 'the stop is delivered, with who received it');
select pg_temp.ok((select status from public.orders where id = '00000000-0000-0000-0000-0000000000e1') = 'completed', 'the order becomes Completed');
select pg_temp.ok((select (value->>'replayed')::boolean and value->>'dr_label' = (select value->>'dr_label' from t where name = 'done') from t where name = 'doneagain'), 'a retried confirmation returns the first result');
select pg_temp.ok((select count(*) from public.order_activity where order_id = '00000000-0000-0000-0000-0000000000e1' and action = 'status_changed' and details->>'to_status' = 'completed') = 1 and (select count(*) from public.delivery_receipts) = 1, 'a retry logs nothing twice and issues one receipt');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000001d1', null, gen_random_uuid())$q$) = 'This delivery is already marked delivered.', 'confirming again with a new tap is refused');
-- The receipt issued at delivery.
select pg_temp.ok((select value->>'dr_label' from t where name = 'done') like 'DR-____', 'the receipt has a DR number separate from the order number');
select pg_temp.ok((select content->>'order_number' like 'ORD-%' and content->>'customer_name' = 'Casa Verde Restaurant' and content->>'delivery_address' = '12 Mabini St., Makati'
  and (content->>'total')::numeric = 392.50 and jsonb_array_length(content->'lines') = 2 and content->>'issued_by_name' = 'Rico Bautista' and content->>'layout' = 'letter'
  from public.delivery_receipts), 'the receipt saves the customer, lines, total (2.5 kg x 85 + 3 x 60 = 392.50) and who issued it');

-- A cancelled order cannot be delivered.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.transition_order_status('00000000-0000-0000-0000-0000000000e2', 'cancelled', '{}'::jsonb)$q$) is null, 'office staff cancel an order out for delivery');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000001d2', null, gen_random_uuid())$q$) like 'This delivery was cancelled%', 'its stop cannot be marked delivered');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.issue_delivery_receipt('00000000-0000-0000-0000-0000000000e2', gen_random_uuid())$q$) like 'This order was cancelled%', 'a cancelled order gets no receipt');
-- Delivered stops cannot be reassigned.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.assign_delivery_driver('00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000000d2', gen_random_uuid())$q$) like 'This delivery is already delivered%', 'a delivered stop keeps its driver');

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.issue_delivery_receipt('00000000-0000-0000-0000-0000000000e4', gen_random_uuid())$q$) = 'You can only get receipts for your own stops', 'a driver cannot get the receipt for another driver''s stop');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.issue_delivery_receipt('00000000-0000-0000-0000-0000000000e4', gen_random_uuid())$q$) = 'You do not have permission to issue delivery receipts', 'purchasing staff cannot issue receipts');
-- Requirement DE-03: the assigned driver can get the receipt for their stop.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d2', $q$select public.issue_delivery_receipt('00000000-0000-0000-0000-0000000000e4', gen_random_uuid())$q$) is null, 'the assigned driver can get the receipt for their stop (DE-03)');
-- ... and the office can issue it as soon as the order is confirmed.
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'confirmed', current_date);
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.issue_delivery_receipt('00000000-0000-0000-0000-0000000000e7', gen_random_uuid())$q$) is null, 'a confirmed order can get its receipt (DE-03)');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.issue_delivery_receipt('00000000-0000-0000-0000-0000000000e6', gen_random_uuid())$q$) like 'A delivery receipt can be issued once%', 'an order For verification gets no receipt yet');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
insert into t values ('r5', public.issue_delivery_receipt('00000000-0000-0000-0000-0000000000e5', gen_random_uuid()));
reset role;
select pg_temp.ok((select value->>'dr_label' <> (select value->>'dr_label' from t where name = 'done') from t where name = 'r5'), 'an order being packed can get its receipt early, with the next number');
-- Reprint: the line changes after issue; the receipt keeps what was issued.
update public.order_items set quantity = 9 where order_id = '00000000-0000-0000-0000-0000000000e5';
update public.customers set business_name = 'Casa Verde (renamed)' where id = '00000000-0000-0000-0000-00000000c001';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
insert into t values ('r5again', public.issue_delivery_receipt('00000000-0000-0000-0000-0000000000e5', gen_random_uuid()));
reset role;
-- Requirement DE-03 (Jac, 4 Nov): the DR number stays; until the delivery is
-- completed, a new download shows the latest saved order.
select pg_temp.ok((select value->>'dr_number' from t where name = 'r5again') = (select value->>'dr_number' from t where name = 'r5'), 'a reprint keeps the same DR number');
select pg_temp.ok((select value->'lines'->0->>'quantity' from t where name = 'r5again')::numeric = 9 and (select value->>'customer_name' from t where name = 'r5again') = 'Casa Verde (renamed)', 'before completion, the receipt shows the latest saved order (DE-03)');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000000a1', $q$select public.get_delivery_receipt('00000000-0000-0000-0000-0000000000e5')$q$)->'content'->'lines'->0->>'quantity')::numeric = 9
  and (select finalized_at is null from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000000e5'), 'opening it gives the same latest version, still not final');
-- Completed delivery (e1): frozen, whatever changes later.
select pg_temp.ok((select finalized_at is not null from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000000e1'), 'marking the delivery completed freezes its receipt (DE-03)');
update public.customers set business_name = 'Casa Verde Restaurant' where id = '00000000-0000-0000-0000-00000000c001';
update public.customers set business_name = 'Renamed after delivery' where id = (select customer_id from public.orders where id = '00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000000d1', $q$select public.get_delivery_receipt('00000000-0000-0000-0000-0000000000e1')$q$)->'content'->>'customer_name') <> 'Renamed after delivery'
  and (pg_temp.run('00000000-0000-0000-0000-0000000000d1', $q$select public.get_delivery_receipt('00000000-0000-0000-0000-0000000000e1')$q$)->>'dr_number')::int = (select dr_number from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000000e1'), 'later downloads reproduce what was delivered, with the same DR number');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d2', $q$select public.get_delivery_receipt('00000000-0000-0000-0000-0000000000e1')$q$) like 'You do not have permission%', 'another driver cannot open it');
select pg_temp.ok(pg_temp.err_owner($q$update public.delivery_receipts set content = '{}' where order_id = '00000000-0000-0000-0000-0000000000e1'$q$) = 'Delivery receipts cannot be changed once issued', 'a frozen receipt cannot be changed, even directly');
select pg_temp.ok((select count(*) from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000000e5') = 1, 'one receipt per order');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$update public.delivery_receipts set dr_number = 999$q$) is not null, 'receipts cannot be edited through the API');
select pg_temp.ok((select count(*) from (select 1 from public.delivery_receipts) x) = 4, 'receipts stay in place');
do $$ begin
  begin
    update public.delivery_receipts set dr_number = 999;
    raise exception 'FAIL receipts were changed by the table owner';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
select pg_temp.ok(true, 'even the database owner cannot edit or delete an issued receipt');
-- Who can read receipts.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
insert into t select 'rico_sees', to_jsonb(count(*)) from public.delivery_receipts;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
insert into t select 'pia_sees', to_jsonb(count(*)) from public.delivery_receipts;
reset role;
select pg_temp.ok((select value::int from t where name = 'rico_sees') = 1, 'a driver sees receipts for their own deliveries only');
select pg_temp.ok((select value::int from t where name = 'pia_sees') = 0, 'purchasing staff do not see receipts');
rollback;
