-- Repacking after an order edit (Jac, 5 Nov 2026, 10:31): only changed lines
-- are unticked, a packed order goes back to Packing with the same delivery,
-- removed packed items must be confirmed, the packing version is required on
-- every tick and completion, and edits stop once the order is out.
\set ON_ERROR_STOP 1
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
  ('00000000-0000-0000-0000-0000000014a1', 'admin14@meah.test', '{"full_name":"Ana Admin"}'),
  ('00000000-0000-0000-0000-0000000014c1', 'office14@meah.test', '{"full_name":"Liza Office"}'),
  ('00000000-0000-0000-0000-0000000014f1', 'packer14@meah.test', '{"full_name":"Pia Packer"}'),
  ('00000000-0000-0000-0000-0000000014d1', 'driver14@meah.test', '{"full_name":"Rico Driver"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000014a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000014c1';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id = '00000000-0000-0000-0000-0000000014f1';
update public.profiles set status = 'active', role = 'delivery_staff' where id = '00000000-0000-0000-0000-0000000014d1';

insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000c141', 'R14-001', 'Casa Verde');
insert into public.products (id, product_name, unit_of_measurement) values
  ('00000000-0000-0000-0000-00000000b141', 'R14 Onions', 'kg'),
  ('00000000-0000-0000-0000-00000000b142', 'R14 Garlic', 'kg');
insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by) values
  ('00000000-0000-0000-0000-00000000b141', 60, 100, now() - interval '1 day', '00000000-0000-0000-0000-0000000014a1'),
  ('00000000-0000-0000-0000-00000000b142', 30, 50, now() - interval '1 day', '00000000-0000-0000-0000-0000000014a1');

-- e1 is being packed; e2, e3, e4 are packed (For delivery) with a delivery for Rico.
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000014e1', '00000000-0000-0000-0000-00000000c141', 'phone', '00000000-0000-0000-0000-0000000014c1', 'for_preparation', current_date + 1),
  ('00000000-0000-0000-0000-0000000014e2', '00000000-0000-0000-0000-00000000c141', 'phone', '00000000-0000-0000-0000-0000000014c1', 'for_delivery', current_date + 1),
  ('00000000-0000-0000-0000-0000000014e3', '00000000-0000-0000-0000-00000000c141', 'phone', '00000000-0000-0000-0000-0000000014c1', 'for_delivery', current_date + 1),
  ('00000000-0000-0000-0000-0000000014e4', '00000000-0000-0000-0000-00000000c141', 'phone', '00000000-0000-0000-0000-0000000014c1', 'for_delivery', current_date + 1);
insert into public.order_items (id, order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price, preparation_status, notes) values
  ('00000000-0000-0000-0000-0000000014b1', '00000000-0000-0000-0000-0000000014e1', '00000000-0000-0000-0000-00000000b141', 5, 'kg', 100, 100, 60, 'completed', null),
  ('00000000-0000-0000-0000-0000000014b2', '00000000-0000-0000-0000-0000000014e1', '00000000-0000-0000-0000-00000000b142', 3, 'kg', 50, 50, 30, 'completed', 'Small bulbs'),
  ('00000000-0000-0000-0000-0000000014b3', '00000000-0000-0000-0000-0000000014e2', '00000000-0000-0000-0000-00000000b141', 4, 'kg', 100, 100, 60, 'completed', null),
  ('00000000-0000-0000-0000-0000000014b4', '00000000-0000-0000-0000-0000000014e2', '00000000-0000-0000-0000-00000000b142', 2, 'kg', 50, 50, 30, 'completed', null),
  ('00000000-0000-0000-0000-0000000014b5', '00000000-0000-0000-0000-0000000014e3', '00000000-0000-0000-0000-00000000b141', 4, 'kg', 100, 100, 60, 'completed', null),
  ('00000000-0000-0000-0000-0000000014b6', '00000000-0000-0000-0000-0000000014e3', '00000000-0000-0000-0000-00000000b142', 2, 'kg', 50, 50, 30, 'completed', null),
  ('00000000-0000-0000-0000-0000000014b7', '00000000-0000-0000-0000-0000000014e4', '00000000-0000-0000-0000-00000000b141', 4, 'kg', 100, 100, 60, 'completed', null),
  ('00000000-0000-0000-0000-0000000014b8', '00000000-0000-0000-0000-0000000014e4', '00000000-0000-0000-0000-00000000b142', 2, 'kg', 50, 50, 30, 'completed', null);
insert into public.deliveries (id, order_id, assigned_driver_id, scheduled_date, scheduled_time, route_position) values
  ('00000000-0000-0000-0000-0000000014d2', '00000000-0000-0000-0000-0000000014e2', '00000000-0000-0000-0000-0000000014d1', current_date + 1, '09:00', 1),
  ('00000000-0000-0000-0000-0000000014d3', '00000000-0000-0000-0000-0000000014e3', '00000000-0000-0000-0000-0000000014d1', current_date + 1, '10:00', 2),
  ('00000000-0000-0000-0000-0000000014d4', '00000000-0000-0000-0000-0000000014e4', '00000000-0000-0000-0000-0000000014d1', current_date + 1, '11:00', 3);

-- The office saves the order form: lines as {product, quantity[, notes]}.
create function pg_temp.edit(p_order uuid, p_lines text, p_date date default current_date + 1) returns text language sql as $$
  select pg_temp.err('00000000-0000-0000-0000-0000000014c1', format($q$select public.edit_order_with_items(%L,
    jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c141', 'requested_delivery_date', %L), %L::jsonb)$q$, p_order, p_date, p_lines));
$$;
create function pg_temp.pv(p_order uuid) returns int language sql as $$ select packing_version from public.orders where id = p_order $$;
create function pg_temp.st(p_item uuid) returns text language sql as $$ select preparation_status::text from public.order_items where id = p_item $$;
create function pg_temp.tick(p_item uuid, p_version int, p_packed boolean default true) returns text language sql as $$
  select pg_temp.err('00000000-0000-0000-0000-0000000014f1', format('select public.set_item_packed(%L, %L, gen_random_uuid(), %L)', p_item, p_packed, p_version));
$$;
create function pg_temp.deliver(p_delivery uuid, p_version int, p_uid uuid default '00000000-0000-0000-0000-0000000014d1') returns text language sql as $$
  select pg_temp.err(p_uid, format('select public.complete_delivery(%L, null, gen_random_uuid(), %L::integer)', p_delivery, p_version));
$$;
create function pg_temp.deliver_offline(p_delivery uuid, p_offline jsonb) returns text language sql as $$
  select pg_temp.err('00000000-0000-0000-0000-0000000014d1', format('select public.offline_complete_delivery(%L, null, gen_random_uuid(), %L)', p_delivery, p_offline));
$$;

-- ===========================================================================
-- 1. Which edits need repacking (order being packed)
-- ===========================================================================
select pg_temp.ok(pg_temp.edit('00000000-0000-0000-0000-0000000014e1',
  '[{"product_id":"00000000-0000-0000-0000-00000000b141","quantity":5,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b142","quantity":3,"unit_of_measurement":"kg","notes":"Big bulbs only"}]',
  current_date + 2) is null, 'the office moves the date and changes a line note');
select pg_temp.ok(pg_temp.st('00000000-0000-0000-0000-0000000014b1') = 'completed' and pg_temp.st('00000000-0000-0000-0000-0000000014b2') = 'completed'
  and pg_temp.pv('00000000-0000-0000-0000-0000000014e1') = 1, 'date and note changes keep every tick and the packing version');
select pg_temp.ok((select note_changed_at is not null from public.order_items where id = '00000000-0000-0000-0000-0000000014b2')
  and (select note_changed_at is null from public.order_items where id = '00000000-0000-0000-0000-0000000014b1'), 'the changed note is marked "Note changed" on that line only');
select pg_temp.ok(pg_temp.edit('00000000-0000-0000-0000-0000000014e1',
  '[{"product_id":"00000000-0000-0000-0000-00000000b141","quantity":6,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b142","quantity":3,"unit_of_measurement":"kg","notes":"Big bulbs only"}]',
  current_date + 2) is null, 'the office changes the onions from 5 to 6 kg');
select pg_temp.ok(pg_temp.st('00000000-0000-0000-0000-0000000014b1') <> 'completed' and pg_temp.st('00000000-0000-0000-0000-0000000014b2') = 'completed',
  'only the changed line is unticked; the garlic keeps its tick');
select pg_temp.ok(pg_temp.pv('00000000-0000-0000-0000-0000000014e1') = 2 and (select status = 'for_preparation' from public.orders where id = '00000000-0000-0000-0000-0000000014e1'),
  'the packing version goes up and the order stays in Packing');
select pg_temp.ok((select (details->>'repack_required')::boolean and jsonb_array_length(details->'changed_lines') = 1 from public.order_activity
  where order_id = '00000000-0000-0000-0000-0000000014e1' and action = 'order_edited' and details->>'packing_version' = '2'), 'the edit is logged with the changed line');
select pg_temp.ok(pg_temp.tick('00000000-0000-0000-0000-0000000014b2', 2, false) is null, 'ticking the line again clears "Note changed" (step)');
select pg_temp.ok(pg_temp.tick('00000000-0000-0000-0000-0000000014b2', 2) is null, 'ticking the line again clears "Note changed" (step 2)');
select pg_temp.ok((select note_changed_at is null from public.order_items where id = '00000000-0000-0000-0000-0000000014b2'), 'ticking the line again clears "Note changed"');

-- ===========================================================================
-- 2. A packed order goes back to Packing with the same delivery
-- ===========================================================================
select pg_temp.ok(pg_temp.edit('00000000-0000-0000-0000-0000000014e2',
  '[{"product_id":"00000000-0000-0000-0000-00000000b141","quantity":4,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b142","quantity":3,"unit_of_measurement":"kg"}]') is null,
  'the office changes the garlic on a packed order from 2 to 3 kg');
select pg_temp.ok((select status = 'for_preparation' and packing_version = 2 from public.orders where id = '00000000-0000-0000-0000-0000000014e2'), 'the order goes back to Packing');
select pg_temp.ok(pg_temp.st('00000000-0000-0000-0000-0000000014b3') = 'completed' and pg_temp.st('00000000-0000-0000-0000-0000000014b4') <> 'completed', 'only the garlic is unticked');
select pg_temp.ok((select count(*) = 1 from public.deliveries where order_id = '00000000-0000-0000-0000-0000000014e2')
  and (select status = 'scheduled' and assigned_driver_id = '00000000-0000-0000-0000-0000000014d1' and scheduled_time = '09:00' and route_position = 1
       from public.deliveries where id = '00000000-0000-0000-0000-0000000014d2'), 'the delivery keeps its record, driver, time and route position');

-- Completion while repacking: refused on every route.
select pg_temp.ok(pg_temp.deliver('00000000-0000-0000-0000-0000000014d2', 2) = 'This order is being repacked after a change. Mark it delivered once packing is finished.',
  'the driver can''t mark it delivered while it is being repacked, even with the new version');
select pg_temp.ok(pg_temp.deliver('00000000-0000-0000-0000-0000000014d2', 2, '00000000-0000-0000-0000-0000000014c1') like 'This order is being repacked%', 'nor can the office');
select pg_temp.ok(pg_temp.deliver_offline('00000000-0000-0000-0000-0000000014d2', jsonb_build_object('queued_at', now(), 'packing_version', 1)) like 'The order was changed and is being repacked%',
  'a "delivered" queued offline before the edit is refused when it syncs');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014d1', $q$select public.update_delivery_status('00000000-0000-0000-0000-0000000014d2', 'completed')$q$) like 'This app version can''t confirm%',
  'the old status action can''t complete it');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014d1', $q$select public.update_delivery_status('00000000-0000-0000-0000-0000000014d2', 'for_delivery')$q$) like 'The order must complete preparation%',
  'and it can''t leave for delivery while repacking');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014f1', $q$select public.cancel_packing('00000000-0000-0000-0000-0000000014e2', gen_random_uuid())$q$) like 'This order was changed after packing and its delivery is already booked%',
  'a repack can''t be stopped back to Confirmed while its delivery is booked');
select pg_temp.ok((select status = 'for_preparation' from public.orders where id = '00000000-0000-0000-0000-0000000014e2'), 'so the order stays in Packing');

-- Stale and missing versions on packing ticks.
select pg_temp.ok(pg_temp.tick('00000000-0000-0000-0000-0000000014b4', 1) like 'Order % changed after this screen was loaded%', 'a tick from a list loaded before the edit is refused');
select pg_temp.ok(pg_temp.tick('00000000-0000-0000-0000-0000000014b4', null) like 'This app version can''t confirm%', 'a tick with no version is refused, never filled in');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014f1', $q$select public.set_item_packed('00000000-0000-0000-0000-0000000014b4', true, gen_random_uuid())$q$) like 'This app version can''t confirm%',
  'the old app''s tick call is refused with an update message');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014f1', format('select public.offline_set_item_packed(%L, true, gen_random_uuid(), %L)', '00000000-0000-0000-0000-0000000014b4',
  jsonb_build_object('queued_at', now(), 'seen', jsonb_build_object('packed', false)))) like 'This app version can''t confirm%', 'an offline tick with no version is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014f1', format('select public.offline_set_item_packed(%L, true, gen_random_uuid(), %L)', '00000000-0000-0000-0000-0000000014b4',
  jsonb_build_object('queued_at', now(), 'packing_version', 1, 'seen', jsonb_build_object('packed', false)))) like 'The order was changed after your list was last updated%', 'an offline tick from before the edit is refused');
select pg_temp.ok(pg_temp.st('00000000-0000-0000-0000-0000000014b4') <> 'completed', 'none of those ticked the line');

-- Repacked: back to For delivery with the same delivery.
select pg_temp.ok(pg_temp.tick('00000000-0000-0000-0000-0000000014b4', 2) is null, 'packing staff repack the garlic with the current list');
select pg_temp.ok((select status = 'for_delivery' from public.orders where id = '00000000-0000-0000-0000-0000000014e2')
  and (select count(*) = 1 from public.deliveries where order_id = '00000000-0000-0000-0000-0000000014e2'), 'the order is For delivery again, with no second delivery');

-- Stale completion after repacking has finished, and missing versions.
select pg_temp.ok(pg_temp.deliver('00000000-0000-0000-0000-0000000014d2', 1) like 'Order % changed after this screen was loaded%', 'a "delivered" from a screen opened before the edit is refused, even though packing is finished');
select pg_temp.ok(pg_temp.deliver('00000000-0000-0000-0000-0000000014d2', null) like 'This app version can''t confirm%', 'a "delivered" with no version is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014d1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000014d2', null, gen_random_uuid())$q$) like 'This app version can''t confirm%',
  'the old app''s Mark delivered call is refused with an update message');
select pg_temp.ok(pg_temp.deliver_offline('00000000-0000-0000-0000-0000000014d2', jsonb_build_object('queued_at', now(), 'packing_version', 1)) like 'The order''s items were changed after this was recorded%',
  'a "delivered" queued offline before the edit is refused when it syncs after repacking');
select pg_temp.ok(pg_temp.deliver_offline('00000000-0000-0000-0000-0000000014d2', jsonb_build_object('queued_at', now())) like 'This app version can''t confirm%',
  'an offline "delivered" with no version is refused');
select pg_temp.ok((select status = 'for_delivery' from public.orders where id = '00000000-0000-0000-0000-0000000014e2'), 'none of those completed it');
select pg_temp.ok(pg_temp.deliver_offline('00000000-0000-0000-0000-0000000014d2', jsonb_build_object('queued_at', now(), 'packing_version', 2)) is null, 'Rico marks it delivered with the current list');
select pg_temp.ok((select o.status = 'completed' and d.status = 'completed' from public.orders o join public.deliveries d on d.order_id = o.id where o.id = '00000000-0000-0000-0000-0000000014e2'), 'order and delivery are completed');
select pg_temp.ok(pg_temp.edit('00000000-0000-0000-0000-0000000014e2',
  '[{"product_id":"00000000-0000-0000-0000-00000000b141","quantity":4,"unit_of_measurement":"kg"}]') = 'Completed and cancelled orders can''t be edited', 'a completed order stays locked');

-- ===========================================================================
-- 3. Removing a packed item needs a confirmation
-- ===========================================================================
select pg_temp.ok(pg_temp.edit('00000000-0000-0000-0000-0000000014e3',
  '[{"product_id":"00000000-0000-0000-0000-00000000b141","quantity":4,"unit_of_measurement":"kg"}]') is null, 'the office removes the packed garlic');
select pg_temp.ok((select status = 'for_preparation' and packing_version = 2 from public.orders where id = '00000000-0000-0000-0000-0000000014e3')
  and pg_temp.st('00000000-0000-0000-0000-0000000014b5') = 'completed', 'the order goes back to Packing; the onions keep their tick');
select pg_temp.ok((select count(*) = 1 and bool_and(confirmed_at is null and description = 'R14 Garlic' and quantity = 2) from public.order_item_removals where order_id = '00000000-0000-0000-0000-0000000014e3'),
  'a removal waits for packing staff: "take out 2 kg R14 Garlic"');
select pg_temp.ok((select jsonb_array_length(details->'removed_lines') = 1 and (details->'removed_lines'->0->>'was_packed')::boolean from public.order_activity
  where order_id = '00000000-0000-0000-0000-0000000014e3' and action = 'order_edited'), 'the removal is in the activity history');
select pg_temp.ok((select status = 'for_preparation' from public.orders where id = '00000000-0000-0000-0000-0000000014e3'),
  'every remaining line is ticked, but the order does not go back to For delivery by itself');
select pg_temp.ok(pg_temp.tick('00000000-0000-0000-0000-0000000014b5', 2) is null, 'not even when a remaining line is ticked again (step)');
select pg_temp.ok((select status = 'for_preparation' from public.orders where id = '00000000-0000-0000-0000-0000000014e3'), 'not even when a remaining line is ticked again');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014a1', $q$select public.transition_order_status('00000000-0000-0000-0000-0000000014e3', 'for_delivery', '{}'::jsonb)$q$) is not null, 'the general status action can''t skip the confirmation (step)');
select pg_temp.ok((select status = 'for_preparation' from public.orders where id = '00000000-0000-0000-0000-0000000014e3'), 'the general status action can''t skip the confirmation');
select pg_temp.ok(pg_temp.deliver('00000000-0000-0000-0000-0000000014d3', 2) like 'This order is being repacked%', 'and it can''t be marked delivered');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014f1', format('select public.confirm_item_removed(%L, 1, gen_random_uuid())',
  (select id from public.order_item_removals where order_id = '00000000-0000-0000-0000-0000000014e3'))) like 'Order % changed after this screen was loaded%', 'a confirmation from an old list is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014f1', format('select public.confirm_item_removed(%L, null, gen_random_uuid())',
  (select id from public.order_item_removals where order_id = '00000000-0000-0000-0000-0000000014e3'))) like 'This app version can''t confirm%', 'a confirmation with no version is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014d1', format('select public.confirm_item_removed(%L, 2, gen_random_uuid())',
  (select id from public.order_item_removals where order_id = '00000000-0000-0000-0000-0000000014e3'))) like 'You do not have permission%', 'drivers can''t confirm removals');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014f1', format('select public.confirm_item_removed(%L, 2, gen_random_uuid())',
  (select id from public.order_item_removals where order_id = '00000000-0000-0000-0000-0000000014e3'))) is null, 'packing staff confirm the garlic was taken out');
select pg_temp.ok((select status = 'for_delivery' from public.orders where id = '00000000-0000-0000-0000-0000000014e3')
  and pg_temp.st('00000000-0000-0000-0000-0000000014b5') = 'completed'
  and (select confirmed_by = '00000000-0000-0000-0000-0000000014f1' from public.order_item_removals where order_id = '00000000-0000-0000-0000-0000000014e3'),
  'the order is For delivery again; no other tick was cleared; who confirmed is kept');
select pg_temp.ok((select count(*) = 1 from public.order_activity where order_id = '00000000-0000-0000-0000-0000000014e3' and action = 'removed_item_confirmed'), 'the confirmation is in the activity history');
select pg_temp.ok((select count(*) = 0 from public.order_item_removals where order_id = '00000000-0000-0000-0000-0000000014e1'), 'removing nothing packed asks for no confirmation');

-- ===========================================================================
-- 4. Out for delivery: item changes are refused
-- ===========================================================================
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014d1', $q$select public.update_delivery_status('00000000-0000-0000-0000-0000000014d4', 'for_delivery')$q$) is null, 'Rico leaves with order e4 (recorded as Out for delivery)');
select pg_temp.ok(pg_temp.edit('00000000-0000-0000-0000-0000000014e4',
  '[{"product_id":"00000000-0000-0000-0000-00000000b141","quantity":5,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b142","quantity":2,"unit_of_measurement":"kg"}]') like 'This order is already out for delivery%',
  'a quantity change is refused once it is out for delivery');
select pg_temp.ok(pg_temp.edit('00000000-0000-0000-0000-0000000014e4',
  '[{"product_id":"00000000-0000-0000-0000-00000000b141","quantity":4,"unit_of_measurement":"kg"}]') like 'This order is already out for delivery%', 'so is removing a line');
select pg_temp.ok(pg_temp.edit('00000000-0000-0000-0000-0000000014e4',
  '[{"product_id":"00000000-0000-0000-0000-00000000b141","quantity":4,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b142","quantity":2,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b142","quantity":1,"unit_of_measurement":"kg"}]') like 'This order is already out for delivery%', 'and adding one');
select pg_temp.ok((select count(*) = 2 and sum(quantity) = 6 from public.order_items where order_id = '00000000-0000-0000-0000-0000000014e4')
  and (select status = 'for_delivery' and packing_version = 1 from public.orders where id = '00000000-0000-0000-0000-0000000014e4')
  and (select count(*) = 0 from public.order_item_removals where order_id = '00000000-0000-0000-0000-0000000014e4'), 'nothing changed');
select pg_temp.ok(pg_temp.edit('00000000-0000-0000-0000-0000000014e4',
  '[{"product_id":"00000000-0000-0000-0000-00000000b141","quantity":4,"unit_of_measurement":"kg","notes":"Leave at the gate"},{"product_id":"00000000-0000-0000-0000-00000000b142","quantity":2,"unit_of_measurement":"kg"}]') is null,
  'a note change still saves while it is out');
select pg_temp.ok((select status = 'for_delivery' from public.deliveries where id = '00000000-0000-0000-0000-0000000014d4'), 'and the stop stays out for delivery (never pulled back)');
select pg_temp.ok(pg_temp.deliver('00000000-0000-0000-0000-0000000014d4', 1) is null, 'Rico marks it delivered');

-- ===========================================================================
-- Reading "Note changed" (8 Nov): the column grant doesn't widen row access
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000014d9', 'driver14b@meah.test', '{"full_name":"Other Driver"}');
update public.profiles set status = 'active', role = 'delivery_staff' where id = '00000000-0000-0000-0000-0000000014d9';
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000014f1',
  $q$select jsonb_build_object('n', count(*)) from (select id, note_changed_at from public.order_items where order_id = '00000000-0000-0000-0000-0000000014e1') x$q$)->>'n')::int = 2,
  'packing staff can read Note changed on lines they may see');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000014d1',
  $q$select jsonb_build_object('n', count(*)) from (select id, note_changed_at from public.order_items where order_id = '00000000-0000-0000-0000-0000000014e4') x$q$)->>'n')::int = 2,
  'a driver can read it on their own stop');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000014d1',
  $q$select jsonb_build_object('n', count(*)) from (select id, note_changed_at from public.order_items where order_id = '00000000-0000-0000-0000-0000000014e1') x$q$)->>'n')::int = 0,
  'but not on an order with no stop of theirs (row rules still apply)');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000014d9',
  $q$select jsonb_build_object('lines', (select count(*) from public.order_items where note_changed_at is not null or note_changed_at is null),
    'removals', (select count(*) from public.order_item_removals))$q$) = '{"lines": 0, "removals": 0}'::jsonb),
  'another driver sees no lines and no removed items at all');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000014f1', $q$select cost_price from public.order_items limit 1$q$) like 'permission denied%',
  'costs on order lines stay hidden (the grant adds only Note changed)');
rollback;
