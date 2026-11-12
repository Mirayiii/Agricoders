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

-- Phase 5 Purchasing: packing checklist and To buy.
begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@meah.test', '{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'office@meah.test', '{"full_name":"Office"}'),
  ('00000000-0000-0000-0000-0000000000f1', 'purchasing@meah.test', '{"full_name":"Purchasing"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'driver@meah.test', '{"full_name":"Driver"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id = '00000000-0000-0000-0000-0000000000f1';
update public.profiles set status = 'active', role = 'delivery_staff' where id = '00000000-0000-0000-0000-0000000000d1';

insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000c001', 'C-001', 'Casa Verde');
-- Tomatoes: stock in a kg SKU (100) and a second kg SKU (20), plus a box SKU (3).
-- Garlic: sold by kg, stock kept in grams. Calamansi: no SKU, so no stock record.
insert into public.products (id, product_name, unit_of_measurement) values
  ('00000000-0000-0000-0000-00000000b001', 'Tomatoes', 'kg'),
  ('00000000-0000-0000-0000-00000000b002', 'Garlic', 'kg'),
  ('00000000-0000-0000-0000-00000000b003', 'Calamansi', 'kg'),
  ('00000000-0000-0000-0000-00000000b004', 'Eggs', 'pc');
-- Stock figures show for products with Track inventory on only.
update public.products set track_stock = true where id in ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000b004');
insert into public.product_skus (id, product_id, selling_sku, unit_of_measurement) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000b001', 'TOM-KG', 'kg'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000b001', 'TOM-KG-B', 'Kilo'),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-00000000b001', 'TOM-BOX', 'box'),
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-00000000b002', 'GAR-G', 'g'),
  ('00000000-0000-0000-0000-0000000005d1', '00000000-0000-0000-0000-00000000b004', 'EGG-PC', 'pcs');
insert into public.inventory (sku_id, current_quantity) values
  ('00000000-0000-0000-0000-0000000005a1', 100),
  ('00000000-0000-0000-0000-0000000005a2', 20),
  ('00000000-0000-0000-0000-0000000005a3', 3),
  ('00000000-0000-0000-0000-0000000005b1', 1500),
  ('00000000-0000-0000-0000-0000000005d1', 30);

-- Orders, dated from Manila's today. o1..o3 confirmed or packing, the rest must not count.
create temp table d as select (now() at time zone 'Asia/Manila')::date as today;
grant select on d to authenticated;
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'for_preparation', (select today from d)),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'confirmed', (select today + 1 from d)),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'confirmed', (select today + 5 from d)),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'for_verification', (select today from d)),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'cancelled', (select today from d)),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'for_delivery', (select today from d)),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-00000000c001', 'phone', '00000000-0000-0000-0000-0000000000c1', 'confirmed', (select today - 2 from d));
insert into public.order_items (id, order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price) values
  -- o1 (packing, today): 50 kg + 30 KG tomatoes, 0.8 kg garlic, 4 kg calamansi
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000b001', 50, 'kg', 85, 85, 60),
  ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000b001', 30, 'KG', 85, 85, 60),
  ('00000000-0000-0000-0000-0000000001a3', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000b002', 0.8, 'kg', 200, 200, 150),
  ('00000000-0000-0000-0000-0000000001a4', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000b003', 4, 'kg', 110, 110, 80),
  -- o2 (confirmed, tomorrow): 60 kg tomatoes, 2 box tomatoes, 900 g garlic, 2 dozen eggs
  ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000b001', 60, 'kg', 85, 85, 60),
  ('00000000-0000-0000-0000-0000000002a2', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000b001', 2, 'box', 900, 900, 600),
  ('00000000-0000-0000-0000-0000000002a3', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000b002', 900, 'g', 0.2, 0.2, 0.15),
  ('00000000-0000-0000-0000-0000000002a4', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000b004', 2, 'dozen', 100, 100, 80),
  -- o3 (confirmed, in 5 days): 10 kg tomatoes
  ('00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000b001', 10, 'kg', 85, 85, 60),
  -- o4 (For verification, today): 9 kg tomatoes. Prototype: it counts too. o5, o6 must never count: 999 kg each.
  ('00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000b001', 9, 'kg', 85, 85, 60),
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000b001', 999, 'kg', 85, 85, 60),
  ('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-00000000b001', 999, 'kg', 85, 85, 60),
  -- o7 (confirmed, two days late): 5 kg tomatoes
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-00000000b001', 5, 'kg', 85, 85, 60);
update public.order_items set preparation_status = 'completed' where order_id = '00000000-0000-0000-0000-0000000000e6';

create temp table t (name text primary key, value jsonb) on commit drop;
grant all on t to authenticated;
create function pg_temp.item(list text, product text, unit text) returns jsonb language sql as $$
  select e from t, jsonb_array_elements(t.value->'items') e
  where t.name = list and e->>'product_name' = product and e->>'unit' = unit;
$$;

-- ---------------------------------------------------------------------------
-- To buy
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.get_buy_list(null, current_date)$q$) like 'You do not have permission%', 'delivery staff cannot see the buy list');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.get_buy_list(current_date, current_date - 1)$q$) = 'The start date must be on or before the end date', 'the range must run forwards');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.get_buy_list(current_date, null)$q$) = 'Choose an end date', 'an end date is required');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.get_buy_list(current_date, current_date + 93)$q$) like 'Choose a range of 93 days%', 'very long ranges are refused');

-- Requirement SI-02: the Purchasing tab is for purchasing staff and the administrator.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.get_buy_list(null, current_date)$q$) like 'You do not have permission%', 'administrative staff cannot see the buy list (SI-02)');

-- The administrator sees stock on hand beside the list (PS-02).
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
-- Immediate: everything due up to tomorrow, late orders included.
insert into t select 'now', public.get_buy_list(null, today + 1) from d;
-- Custom: today to six days ahead, no late orders.
insert into t select 'week', public.get_buy_list(today, today + 6) from d;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
insert into t select 'purchasing', public.get_buy_list(null, today + 1) from d;
reset role;

select pg_temp.ok((select (value->>'today')::date = (select today from d) from t where name = 'now'), 'the list reports today in Manila');
select pg_temp.ok((select (value->>'overdue_orders')::int = 1 from t where name = 'now'), 'Immediate counts the one late order');
select pg_temp.ok((select (value->>'overdue_orders')::int = 0 from t where name = 'week'), 'a custom range has no late orders');
-- Tomatoes in kg (now): 50 + 30 + 60 + 5 + 9 = 154 kg; stock 100 + 20 (the "Kilo" SKU) = 120, counted once.
select pg_temp.ok((pg_temp.item('now', 'Tomatoes', 'kg')->>'quantity')::numeric = 154, 'kg, KG lines are added together, For verification included (154 kg)');
select pg_temp.ok((pg_temp.item('now', 'Tomatoes', 'kg')->>'stock')::numeric = 120, 'stock from both kg SKUs is counted once (120 kg), however many lines ask');
select pg_temp.ok((pg_temp.item('now', 'Tomatoes', 'kg')->>'short_by')::numeric = 34, 'shortage is 154 - 120 = 34 kg');
select pg_temp.ok((pg_temp.item('now', 'Tomatoes', 'kg')->>'remaining')::numeric = 34, 'and that is what is left to buy');
select pg_temp.ok((pg_temp.item('now', 'Tomatoes', 'kg')->>'order_count')::int = 4, 'four orders ask for tomatoes in kg');
-- Boxes are not mixed with kg.
select pg_temp.ok((pg_temp.item('now', 'Tomatoes', 'box')->>'quantity')::numeric = 2 and (pg_temp.item('now', 'Tomatoes', 'box')->>'stock')::numeric = 3 and (pg_temp.item('now', 'Tomatoes', 'box')->>'short_by')::numeric = 0, 'boxes are a separate line, compared with box stock only');
-- Garlic: 0.8 kg + 900 g = 1.7 kg; stock 1500 g = 1.5 kg; short 0.2 kg.
select pg_temp.ok((pg_temp.item('now', 'Garlic', 'kg')->>'quantity')::numeric = 1.7, 'grams are counted as kilograms (0.8 kg + 900 g = 1.7 kg)');
select pg_temp.ok((pg_temp.item('now', 'Garlic', 'kg')->>'stock')::numeric = 1.5 and (pg_temp.item('now', 'Garlic', 'kg')->>'short_by')::numeric = 0.2, 'gram stock is compared in kg (1.5 kg on hand, 0.2 kg short)');
select pg_temp.ok((pg_temp.item('now', 'Garlic', 'kg')->>'remaining')::numeric = 0.2, 'grams are converted before stock is subtracted: 1.7 kg - 1500 g = 0.2 kg to buy');
select pg_temp.ok((pg_temp.item('now', 'Eggs', 'pc')->>'remaining')::numeric = 0, 'dozens are converted before stock is subtracted: 24 pc needed, 30 pcs on hand, nothing to buy');
select pg_temp.ok((pg_temp.item('now', 'Tomatoes', 'box')->>'remaining')::numeric = 0, 'boxes are subtracted from box stock only');
-- Eggs: 2 dozen = 24 pc, product unit pc, stock 30 pcs.
select pg_temp.ok((pg_temp.item('now', 'Eggs', 'pc')->>'quantity')::numeric = 24 and (pg_temp.item('now', 'Eggs', 'pc')->>'stock')::numeric = 30, 'dozens are counted as pieces and pcs stock matches pc');
-- Calamansi has no SKU: no stock figure, no made-up shortage.
select pg_temp.ok((pg_temp.item('now', 'Calamansi', 'kg') ? 'stock') and pg_temp.item('now', 'Calamansi', 'kg')->'stock' = 'null'::jsonb and pg_temp.item('now', 'Calamansi', 'kg')->'short_by' = 'null'::jsonb, 'a product with no stock record shows no stock figure');
select pg_temp.ok(pg_temp.item('now', 'Calamansi', 'kg')->'remaining' = 'null'::jsonb, 'and nothing to buy is worked out from it: unknown stock is not zero stock');
-- Track inventory off: the stock records are kept, but no stock figure shows.
update public.products set track_stock = false where id = '00000000-0000-0000-0000-00000000b002';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
insert into t select 'untracked', public.get_buy_list(null, today + 1) from d;
reset role;
update public.products set track_stock = true where id = '00000000-0000-0000-0000-00000000b002';
select pg_temp.ok(pg_temp.item('untracked', 'Garlic', 'kg')->'stock' = 'null'::jsonb and pg_temp.item('untracked', 'Garlic', 'kg')->'short_by' = 'null'::jsonb
  and pg_temp.item('untracked', 'Garlic', 'kg')->'track_stock' = 'false'::jsonb and (pg_temp.item('untracked', 'Garlic', 'kg')->>'quantity')::numeric = 1.7,
  'an untracked product shows its demand but no stock or shortage');
select pg_temp.ok(pg_temp.item('untracked', 'Garlic', 'kg')->'remaining' = 'null'::jsonb, 'an untracked product''s stock is not treated as zero');
select pg_temp.ok(pg_temp.item('untracked', 'Tomatoes', 'kg')->'track_stock' = 'true'::jsonb and (pg_temp.item('untracked', 'Tomatoes', 'kg')->>'stock')::numeric = 120, 'a tracked product still shows its stock');
select pg_temp.ok((select jsonb_array_length(value->'items') = 5 from t where name = 'now'), 'five lines: tomatoes kg and box, garlic, calamansi, eggs');
-- For verification, Confirmed and Packing count; the 999 kg lines never appear.
select pg_temp.ok(not exists (select 1 from t, jsonb_array_elements(t.value->'items') e where (e->>'quantity')::numeric >= 999), 'cancelled and For delivery orders are left out');
-- The week: tomatoes kg = 50 + 30 + 60 + 10 + 9 = 159 (no late order).
select pg_temp.ok((pg_temp.item('week', 'Tomatoes', 'kg')->>'quantity')::numeric = 159, 'a custom range uses the dates given (159 kg over the week)');
select pg_temp.ok((select value->'items' from t where name = 'purchasing') = (select value->'items' from t where name = 'now'),
  'purchasing staff see the same list, stock and shortfall included (prototype)');
select pg_temp.ok((select current_quantity from public.inventory where sku_id = '00000000-0000-0000-0000-0000000005a1') = 100 and (select count(*) from public.inventory_transactions) = 0, 'the buy list changes no stock');

-- ---------------------------------------------------------------------------
-- Packing
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.set_item_packed('00000000-0000-0000-0000-0000000001a1', true, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000001a1'))$q$) like 'You do not have permission%', 'delivery staff cannot pack');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.start_packing('00000000-0000-0000-0000-0000000000e2', gen_random_uuid())$q$) like 'You do not have permission%', 'delivery staff cannot start packing');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.set_item_packed('00000000-0000-0000-0000-0000000001a1', true, null, tests.pv_item('00000000-0000-0000-0000-0000000001a1'))$q$) = 'A request id is required', 'a request id is required');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.set_item_packed('00000000-0000-0000-0000-0000000002a1', true, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000002a1'))$q$) like 'Packing has not started%', 'a confirmed order cannot be ticked before Start packing');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.start_packing('00000000-0000-0000-0000-0000000000e4', gen_random_uuid())$q$) like 'This order is not confirmed yet%', 'an order For verification cannot be packed');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.start_packing('00000000-0000-0000-0000-0000000000e5', gen_random_uuid())$q$) like 'This order was cancelled%', 'a cancelled order cannot start packing');

-- Tick one line; the tick is stored and a retry does not tick twice.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
insert into t values ('tick1', public.set_item_packed('00000000-0000-0000-0000-0000000001a1', true, '33333333-3333-4333-8333-333333333331', tests.pv_item('00000000-0000-0000-0000-0000000001a1')));
insert into t values ('tick1again', public.set_item_packed('00000000-0000-0000-0000-0000000001a1', true, '33333333-3333-4333-8333-333333333331', tests.pv_item('00000000-0000-0000-0000-0000000001a1')));
reset role;
select pg_temp.ok((select preparation_status = 'completed' and prepared_by = '00000000-0000-0000-0000-0000000000f1' and prepared_at is not null from public.order_items where id = '00000000-0000-0000-0000-0000000001a1'), 'the tick is saved on the line with who and when');
select pg_temp.ok((select (value->>'packed_count')::int = 1 and (value->>'item_count')::int = 4 and value->>'status' = 'for_preparation' from t where name = 'tick1'), 'the result has the progress (1 of 4)');
select pg_temp.ok((select (value->>'replayed')::boolean from t where name = 'tick1again'), 'a retry returns the first result');
select pg_temp.ok((select count(*) from public.order_activity where order_id = '00000000-0000-0000-0000-0000000000e1' and action = 'preparation_status_changed') = 1, 'a retried tick is logged once');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.set_item_packed('00000000-0000-0000-0000-0000000001a1', false, '33333333-3333-4333-8333-333333333331', tests.pv_item('00000000-0000-0000-0000-0000000001a1'))$q$) = 'request_id_reused', 'a request id cannot be reused for a different change');

-- Untick to undo a mistaken tap.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
insert into t values ('untick', public.set_item_packed('00000000-0000-0000-0000-0000000001a1', false, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000001a1')));
reset role;
select pg_temp.ok((select preparation_status = 'in_progress' and prepared_by is null from public.order_items where id = '00000000-0000-0000-0000-0000000001a1'), 'unticking clears the tick');
select pg_temp.ok((select (value->>'packed_count')::int = 0 from t where name = 'untick'), 'progress goes back to 0 of 4');

-- A cancelled order cannot advance: cancel it (office), then try to tick.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.transition_order_status('00000000-0000-0000-0000-0000000000e1', 'cancelled', '{}'::jsonb)$q$) is null, 'office staff cancel the order being packed');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.set_item_packed('00000000-0000-0000-0000-0000000001a2', true, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000001a2'))$q$) = 'This order was cancelled, so it can no longer be packed.', 'ticking a line of a cancelled order is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.cancel_packing('00000000-0000-0000-0000-0000000000e1', gen_random_uuid())$q$) like 'This order was cancelled%', 'a cancelled order cannot be moved back to Ready to start');
select pg_temp.ok((select status from public.orders where id = '00000000-0000-0000-0000-0000000000e1') = 'cancelled' and (select count(*) from public.order_items where order_id = '00000000-0000-0000-0000-0000000000e1' and preparation_status = 'completed') = 0, 'the cancelled order stays cancelled and nothing was ticked');
-- The old packing call is refused for it too.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.update_preparation_status('00000000-0000-0000-0000-0000000001a2', 'in_progress', null)$q$) like 'This app version can''t confirm%', 'the old packing call is refused (no packing version), so it also refuses a cancelled order');

-- Start packing o2, cancel packing, start again: ticks are kept.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
insert into t values ('start', public.start_packing('00000000-0000-0000-0000-0000000000e2', '44444444-4444-4444-8444-444444444441'));
insert into t values ('startagain', public.start_packing('00000000-0000-0000-0000-0000000000e2', '44444444-4444-4444-8444-444444444441'));
select public.set_item_packed('00000000-0000-0000-0000-0000000002a1', true, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000002a1'));
insert into t values ('cancelpack', public.cancel_packing('00000000-0000-0000-0000-0000000000e2', gen_random_uuid()));
reset role;
select pg_temp.ok((select value->>'status' = 'for_preparation' and (value->>'item_count')::int = 4 from t where name = 'start'), 'Start packing moves the order to For preparation');
select pg_temp.ok((select (value->>'replayed')::boolean from t where name = 'startagain'), 'a retried Start packing returns the first result');
select pg_temp.ok((select count(*) from public.order_activity where order_id = '00000000-0000-0000-0000-0000000000e2' and details->>'to_status' = 'for_preparation') = 1, 'Start packing is logged once');
select pg_temp.ok((select status from public.orders where id = '00000000-0000-0000-0000-0000000000e2') = 'confirmed', 'Cancel packing moves the order back to Confirmed');
select pg_temp.ok((select preparation_status from public.order_items where id = '00000000-0000-0000-0000-0000000002a1') = 'completed', 'Cancel packing keeps the ticks');
select pg_temp.ok(exists (select 1 from public.order_activity where order_id = '00000000-0000-0000-0000-0000000000e2' and details->>'reason' = 'packing_cancelled'), 'Cancel packing is logged');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.set_item_packed('00000000-0000-0000-0000-0000000002a2', true, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000002a2'))$q$) like 'Packing has not started%', 'after Cancel packing, lines cannot be ticked');

-- Pack every line: the order moves to For delivery, once.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
select public.start_packing('00000000-0000-0000-0000-0000000000e2', gen_random_uuid());
select public.set_item_packed('00000000-0000-0000-0000-0000000002a2', true, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000002a2'));
select public.set_item_packed('00000000-0000-0000-0000-0000000002a3', true, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000002a3'));
-- Ticking a ticked line changes nothing.
insert into t values ('noop', public.set_item_packed('00000000-0000-0000-0000-0000000002a1', true, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000002a1')));
insert into t values ('last', public.set_item_packed('00000000-0000-0000-0000-0000000002a4', true, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000002a4')));
reset role;
select pg_temp.ok((select (value->>'packed_count')::int = 3 and value->>'status' = 'for_preparation' from t where name = 'noop'), 'ticking a ticked line changes nothing');
select pg_temp.ok((select value->>'status' = 'for_delivery' and (value->>'packed_count')::int = 4 from t where name = 'last'), 'the last tick moves the order to For delivery');
select pg_temp.ok((select count(*) from public.order_activity where order_id = '00000000-0000-0000-0000-0000000000e2' and details->>'to_status' = 'for_delivery') = 1, 'the move to For delivery is logged once');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.set_item_packed('00000000-0000-0000-0000-0000000002a4', false, gen_random_uuid(), tests.pv_item('00000000-0000-0000-0000-0000000002a4'))$q$) = 'This order is already packed and waiting for delivery.', 'a packed order cannot be unticked');
select pg_temp.ok((select current_quantity from public.inventory where sku_id = '00000000-0000-0000-0000-0000000005a1') = 100 and (select count(*) from public.inventory_transactions) = 0, 'provisional: packing does not deduct stock');
-- Administrators can pack.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.start_packing('00000000-0000-0000-0000-0000000000e3', gen_random_uuid())$q$) is null, 'administrators can start packing');
-- A changed line must be packed again: the tick is cleared when the product,
-- quantity or unit changes, but not for other edits.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
update public.order_items set preparation_status = 'completed', prepared_by = '00000000-0000-0000-0000-0000000000f1', prepared_at = now()
  where id in ('00000000-0000-0000-0000-0000000003a1');
update public.order_items set notes = 'Ripe ones' where id = '00000000-0000-0000-0000-0000000003a1';
select pg_temp.ok((select preparation_status from public.order_items where id = '00000000-0000-0000-0000-0000000003a1') = 'completed', 'a note change keeps the tick');
update public.order_items set unit_of_measurement = 'Kg ' where id = '00000000-0000-0000-0000-0000000003a1';
select pg_temp.ok((select preparation_status from public.order_items where id = '00000000-0000-0000-0000-0000000003a1') = 'completed', 'the same unit written differently keeps the tick');
update public.order_items set quantity = 12 where id = '00000000-0000-0000-0000-0000000003a1';
select pg_temp.ok((select preparation_status = 'in_progress' and prepared_by is null and prepared_at is null from public.order_items where id = '00000000-0000-0000-0000-0000000003a1'), 'a quantity change clears the tick');
select pg_temp.ok(exists (select 1 from public.order_activity where details->>'item_id' = '00000000-0000-0000-0000-0000000003a1' and details->>'reason' = 'line_changed'), 'the cleared tick is logged');
update public.order_items set preparation_status = 'completed' where id = '00000000-0000-0000-0000-0000000003a1';
update public.order_items set unit_of_measurement = 'box' where id = '00000000-0000-0000-0000-0000000003a1';
select pg_temp.ok((select preparation_status from public.order_items where id = '00000000-0000-0000-0000-0000000003a1') = 'in_progress', 'a unit change clears the tick');
update public.order_items set preparation_status = 'completed' where id = '00000000-0000-0000-0000-0000000003a1';
update public.order_items set product_id = '00000000-0000-0000-0000-00000000b002' where id = '00000000-0000-0000-0000-0000000003a1';
select pg_temp.ok((select preparation_status from public.order_items where id = '00000000-0000-0000-0000-0000000003a1') = 'in_progress', 'a product change clears the tick');
rollback;
