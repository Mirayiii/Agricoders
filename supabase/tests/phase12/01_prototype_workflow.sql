-- Order workflow from MEAH-Prototype 2.html (Jac, 5 Nov 2026): edit order at
-- any open status, the delivery created when an order is packed, and mark
-- delivered by the office with no driver (see phase11 for the roles).
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
create function pg_temp.run(uid uuid, sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  set local role authenticated;
  execute sql into v;
  reset role;
  return v;
end $$;

begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000012a1', 'admin12@meah.test', '{"full_name":"Ana Admin"}'),
  ('00000000-0000-0000-0000-0000000012c1', 'office12@meah.test', '{"full_name":"Liza Office"}'),
  ('00000000-0000-0000-0000-0000000012f1', 'purchasing12@meah.test', '{"full_name":"Pia Purchasing"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000012a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000012c1';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id = '00000000-0000-0000-0000-0000000012f1';

create temp table d as select (now() at time zone 'Asia/Manila')::date as today;
grant select on d to authenticated;

insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000c121', 'W12-001', 'Casa Verde');
insert into public.products (id, product_name, unit_of_measurement) values ('00000000-0000-0000-0000-00000000b121', 'W12 Onions', 'kg');

insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date, delivery_time_start) values
  ('00000000-0000-0000-0000-0000000012e1', '00000000-0000-0000-0000-00000000c121', 'phone', '00000000-0000-0000-0000-0000000012c1', 'for_preparation', (select today from d), '09:30'),
  ('00000000-0000-0000-0000-0000000012e2', '00000000-0000-0000-0000-00000000c121', 'phone', '00000000-0000-0000-0000-0000000012c1', 'for_preparation', (select today from d), '14:00'),
  ('00000000-0000-0000-0000-0000000012e3', '00000000-0000-0000-0000-00000000c121', 'phone', '00000000-0000-0000-0000-0000000012c1', 'completed', (select today from d), null);
insert into public.order_items (id, order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price, preparation_status) values
  ('00000000-0000-0000-0000-0000000012b1', '00000000-0000-0000-0000-0000000012e1', '00000000-0000-0000-0000-00000000b121', 10, 'kg', 100, 100, 70, 'completed'),
  ('00000000-0000-0000-0000-0000000012b2', '00000000-0000-0000-0000-0000000012e2', '00000000-0000-0000-0000-00000000b121', 5, 'kg', 100, 100, 70, 'pending'),
  ('00000000-0000-0000-0000-0000000012b3', '00000000-0000-0000-0000-0000000012e3', '00000000-0000-0000-0000-00000000b121', 5, 'kg', 100, 100, 70, 'completed');

-- ===========================================================================
-- Edit order at any open status
-- ===========================================================================
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000012c1', format($q$select public.edit_order_with_items('00000000-0000-0000-0000-0000000012e1',
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c121', 'requested_delivery_date', %L),
  '[{"product_id":"00000000-0000-0000-0000-00000000b121","quantity":12,"unit_of_measurement":"kg"}]')$q$, (select today from d))) is null,
  'administrative staff edit an order that is being packed');
select pg_temp.ok((select status = 'for_preparation' from public.orders where id = '00000000-0000-0000-0000-0000000012e1'), 'it stays in packing');
select pg_temp.ok((select bool_and(preparation_status <> 'completed') and sum(quantity) = 12 and min(unit_price) = 100 from public.order_items where order_id = '00000000-0000-0000-0000-0000000012e1'),
  'the changed line comes back unpacked, with the new quantity and the saved price');
select pg_temp.ok((select (details->>'repack_required')::boolean and details->>'status' = 'for_preparation' from public.order_activity where order_id = '00000000-0000-0000-0000-0000000012e1' and action = 'order_edited'),
  'the edit is logged with the status and that repacking is needed');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000012c1', format($q$select public.edit_order_with_items('00000000-0000-0000-0000-0000000012e3',
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c121', 'requested_delivery_date', %L),
  '[{"product_id":"00000000-0000-0000-0000-00000000b121","quantity":1,"unit_of_measurement":"kg"}]')$q$, (select today from d))) = 'Completed and cancelled orders can''t be edited',
  'completed orders stay locked');
select pg_temp.ok((select sum(quantity) = 5 from public.order_items where order_id = '00000000-0000-0000-0000-0000000012e3'), 'and keep their lines');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000012f1', format($q$select public.edit_order_with_items('00000000-0000-0000-0000-0000000012e1',
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c121', 'requested_delivery_date', %L),
  '[{"product_id":"00000000-0000-0000-0000-00000000b121","quantity":1,"unit_of_measurement":"kg"}]')$q$, (select today from d))) = 'You do not have permission to edit orders',
  'purchasing staff cannot edit orders');

-- ===========================================================================
-- Packing the last line creates the delivery
-- ===========================================================================
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000012f1', $q$select public.set_item_packed('00000000-0000-0000-0000-0000000012b2', true, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000012b2'))$q$) is null, 'purchasing packs the last line');
select pg_temp.ok((select status = 'for_delivery' from public.orders where id = '00000000-0000-0000-0000-0000000012e2'), 'the order is ready for delivery');
select pg_temp.ok((select count(*) = 1 from public.deliveries where order_id = '00000000-0000-0000-0000-0000000012e2'
    and scheduled_date = (select today from d) and scheduled_time = '14:00' and assigned_driver_id is null and status = 'scheduled'),
  'its delivery is created for the order''s date and start time, with no driver yet');
select pg_temp.ok((select count(*) = 1 from public.order_activity where order_id = '00000000-0000-0000-0000-0000000012e2' and action = 'delivery_created' and details->>'reason' = 'packed'), 'and logged');

-- The office can still set the date, time and driver through the old form.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000012c1', format($q$select public.create_delivery('00000000-0000-0000-0000-0000000012e2', %L, '15:00', null, 'Gate 2')$q$, (select today + 1 from d))) is null, 'the office changes the created delivery');
select pg_temp.ok((select count(*) = 1 from public.deliveries where order_id = '00000000-0000-0000-0000-0000000012e2'), 'there is still one delivery');
select pg_temp.ok((select scheduled_date = (select today + 1 from d) and scheduled_time = '15:00' and notes = 'Gate 2' from public.deliveries where order_id = '00000000-0000-0000-0000-0000000012e2'), 'with the new date, time and notes');

-- Editing a packed order moves its open delivery with the new date.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000012c1', format($q$select public.edit_order_with_items('00000000-0000-0000-0000-0000000012e2',
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c121', 'requested_delivery_date', %L),
  '[{"product_id":"00000000-0000-0000-0000-00000000b121","quantity":5,"notes":"Ring the bell","unit_of_measurement":"kg"}]')$q$, (select today + 2 from d))) is null, 'the office moves the date of a packed order and adds a line note');
select pg_temp.ok((select status = 'for_delivery' from public.orders where id = '00000000-0000-0000-0000-0000000012e2'), 'a date or note change keeps it ready for delivery, with its ticks');
select pg_temp.ok((select scheduled_date = (select today + 2 from d) from public.deliveries where order_id = '00000000-0000-0000-0000-0000000012e2'), 'its delivery moves to the new date');

-- ===========================================================================
-- The office marks it delivered with no driver
-- ===========================================================================
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000012c1', format($q$select public.complete_delivery(%1$L, 'Mark', gen_random_uuid(), tests.pv_delivery(%1$L))$q$, (select id from public.deliveries where order_id = '00000000-0000-0000-0000-0000000012e2'))) is null, 'the office marks it delivered');
select pg_temp.ok((select o.status = 'completed' and d.status = 'completed' and d.received_by = 'Mark' from public.orders o join public.deliveries d on d.order_id = o.id where o.id = '00000000-0000-0000-0000-0000000012e2'), 'order and delivery are completed');
select pg_temp.ok((select finalized_at is not null from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000012e2'), 'and its receipt is frozen');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000012a1', $q$update public.orders set status = 'completed' where id = '00000000-0000-0000-0000-0000000012e1'$q$) is not null, 'an order still can''t be completed without its delivery');
rollback;
