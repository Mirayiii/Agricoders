-- Jac's 4 Nov decisions on the requirements document (Revision 2.1):
-- DE-04 completion, the buy list (read-only since 5 Nov) and HD-03 counts, NO-02 usual
-- quantities, AS-03 push switches, CU-01 restore.
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
  ('00000000-0000-0000-0000-0000000011a1', 'admin11@meah.test', '{"full_name":"Ana Admin"}'),
  ('00000000-0000-0000-0000-0000000011c1', 'office11@meah.test', '{"full_name":"Liza Office"}'),
  ('00000000-0000-0000-0000-0000000011f1', 'purchasing11@meah.test', '{"full_name":"Pia Purchasing"}'),
  ('00000000-0000-0000-0000-0000000011d1', 'driver11@meah.test', '{"full_name":"Rico Driver"}'),
  ('00000000-0000-0000-0000-0000000011d2', 'driver11b@meah.test', '{"full_name":"Jun Driver"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000011a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000011c1';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id = '00000000-0000-0000-0000-0000000011f1';
update public.profiles set status = 'active', role = 'delivery_staff' where id in ('00000000-0000-0000-0000-0000000011d1', '00000000-0000-0000-0000-0000000011d2');

create temp table d as select (now() at time zone 'Asia/Manila')::date as today;
grant select on d to authenticated;
create temp table t (name text primary key, value jsonb) on commit drop;
grant all on t to authenticated;

insert into public.customers (id, customer_code, business_name) values
  ('00000000-0000-0000-0000-00000000c111', 'R11-001', 'Casa Verde'),
  ('00000000-0000-0000-0000-00000000c112', 'R11-002', 'Kusina Uno');
insert into public.products (id, product_name, unit_of_measurement) values
  ('00000000-0000-0000-0000-00000000b111', 'R11 Onions', 'kg'),
  ('00000000-0000-0000-0000-00000000b112', 'R11 Garlic', 'kg');

-- ===========================================================================
-- Mark delivered: administrator, administrative staff or the assigned driver
-- ===========================================================================
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000011e1', '00000000-0000-0000-0000-00000000c111', 'phone', '00000000-0000-0000-0000-0000000011c1', 'for_delivery', (select today from d)),
  ('00000000-0000-0000-0000-0000000011e2', '00000000-0000-0000-0000-00000000c111', 'phone', '00000000-0000-0000-0000-0000000011c1', 'for_delivery', (select today from d));
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price, preparation_status) values
  ('00000000-0000-0000-0000-0000000011e1', '00000000-0000-0000-0000-00000000b111', 10, 'kg', 100, 100, 70, 'completed'),
  ('00000000-0000-0000-0000-0000000011e2', '00000000-0000-0000-0000-00000000b111', 10, 'kg', 100, 100, 70, 'completed');
insert into public.deliveries (id, order_id, assigned_driver_id, scheduled_date, status) values
  ('00000000-0000-0000-0000-0000000011f8', '00000000-0000-0000-0000-0000000011e1', null, (select today from d), 'for_delivery'),
  ('00000000-0000-0000-0000-0000000011f9', '00000000-0000-0000-0000-0000000011e2', '00000000-0000-0000-0000-0000000011d1', (select today from d), 'for_delivery');

-- Prototype (5 Nov) replaces DE-04: no driver is needed; the administrator,
-- administrative staff or the assigned driver marks the stop delivered.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011d2', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000011f9', null, gen_random_uuid(), tests.pv_delivery('00000000-0000-0000-0000-0000000011f9'))$q$) is not null, 'another driver cannot complete Rico''s stop');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011f1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000011f8', null, gen_random_uuid(), tests.pv_delivery('00000000-0000-0000-0000-0000000011f8'))$q$) = 'You do not have permission to mark deliveries delivered', 'purchasing staff cannot complete a stop');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011d1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000011f8', null, gen_random_uuid(), tests.pv_delivery('00000000-0000-0000-0000-0000000011f8'))$q$) = 'You can only confirm your own stops', 'a driver cannot complete a stop with no driver');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011c1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000011f8', 'Ana', gen_random_uuid(), tests.pv_delivery('00000000-0000-0000-0000-0000000011f8'))$q$) is null, 'administrative staff complete a stop with no driver');
select pg_temp.ok((select status = 'completed' from public.orders where id = '00000000-0000-0000-0000-0000000011e1'), 'and the order is completed');
select pg_temp.ok((select received_by = 'Ana' and assigned_driver_id is null from public.deliveries where id = '00000000-0000-0000-0000-0000000011f8'), 'received-by is kept, still with no driver');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011d1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000011f9', 'Mark', gen_random_uuid(), tests.pv_delivery('00000000-0000-0000-0000-0000000011f9'))$q$) is null, 'the assigned driver completes their stop');
select pg_temp.ok((select status = 'completed' from public.orders where id = '00000000-0000-0000-0000-0000000011e2'), 'and that order is completed');

-- ===========================================================================
-- To buy: read-only, demand less stock (prototype, 5 Nov; was PU-01)
-- ===========================================================================
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000012e1', '00000000-0000-0000-0000-00000000c112', 'phone', '00000000-0000-0000-0000-0000000011c1', 'confirmed', (select today from d)),
  ('00000000-0000-0000-0000-0000000012e2', '00000000-0000-0000-0000-00000000c112', 'phone', '00000000-0000-0000-0000-0000000011c1', 'confirmed', (select today + 1 from d)),
  ('00000000-0000-0000-0000-0000000012e3', '00000000-0000-0000-0000-00000000c112', 'phone', '00000000-0000-0000-0000-0000000011c1', 'confirmed', (select today + 2 from d));
insert into public.order_items (id, order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price) values
  ('00000000-0000-0000-0000-0000000012a1', '00000000-0000-0000-0000-0000000012e1', '00000000-0000-0000-0000-00000000b111', 20, 'kg', 100, 100, 70),
  ('00000000-0000-0000-0000-0000000012a2', '00000000-0000-0000-0000-0000000012e2', '00000000-0000-0000-0000-00000000b111', 10, 'kg', 100, 100, 70),
  ('00000000-0000-0000-0000-0000000012a3', '00000000-0000-0000-0000-0000000012e3', '00000000-0000-0000-0000-00000000b111', 15, 'kg', 100, 100, 70),
  ('00000000-0000-0000-0000-0000000012a4', '00000000-0000-0000-0000-0000000012e1', '00000000-0000-0000-0000-00000000b112', 2, 'kg', 200, 200, 150);

create function pg_temp.line(uid uuid, p_from date, p_to date, product text) returns jsonb language sql as $$
  select e from jsonb_array_elements(pg_temp.run(uid, format('select public.get_buy_list(%L, %L)', p_from, p_to))->'items') e
  where e->>'product_name' = product;
$$;
create function pg_temp.list(uid uuid, p_from date, p_to date) returns jsonb language sql as $$
  select pg_temp.run(uid, format('select public.get_buy_list(%L, %L)', p_from, p_to));
$$;

-- Prototype (5 Nov, replaces PU-01 ticks): the list is read-only; what is left
-- to buy is the demand less the stock on hand.
select pg_temp.ok((pg_temp.line('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d), 'R11 Onions')->>'quantity')::numeric = 45
  and pg_temp.line('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d), 'R11 Onions')->'remaining' = 'null'::jsonb, 'three days need 45 kg of onions; stock isn''t tracked, so nothing is subtracted or assumed');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011f1', $q$select public.set_buy_list_bought('00000000-0000-0000-0000-00000000b111', 'kg', null, current_date, true, gen_random_uuid())$q$) like 'The buy list no longer has ticks%', 'lines can no longer be ticked as bought');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011c1', $q$select public.set_buy_list_bought('00000000-0000-0000-0000-00000000b111', 'kg', null, current_date, true, gen_random_uuid())$q$) like 'Only purchasing staff and administrators%', 'administrative staff are refused first');
select pg_temp.ok((select count(*) = 0 from public.buy_list_purchases where product_id = '00000000-0000-0000-0000-00000000b111'), 'nothing is saved as bought');
-- Stock on hand lowers what is left to buy.
update public.products set track_stock = true where id = '00000000-0000-0000-0000-00000000b111';
insert into public.product_skus (id, product_id, selling_sku, unit_of_measurement) values ('00000000-0000-0000-0000-0000000011b5', '00000000-0000-0000-0000-00000000b111', 'R11-ON-KG', 'kg');
insert into public.inventory (sku_id, current_quantity) values ('00000000-0000-0000-0000-0000000011b5', 30);
select pg_temp.ok((pg_temp.line('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d), 'R11 Onions')->>'stock')::numeric = 30
  and (pg_temp.line('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d), 'R11 Onions')->>'remaining')::numeric = 15, 'with 30 kg in stock, purchasing sees 15 kg left to buy');
select pg_temp.ok((pg_temp.list('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d))->>'short_lines')::int = 1, 'one tracked line is short of stock (untracked garlic has no stock figure)');
-- Purchasing Home: today's order needs 20 kg onions (30 in stock) and 2 kg garlic.
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000011f1', $q$select public.get_purchasing_today()$q$)->>'awaiting_buying')::int = 0,
  'Purchasing Home: untracked garlic is not counted as short (its stock is unknown, not zero)');
insert into public.product_skus (id, product_id, selling_sku, unit_of_measurement) values ('00000000-0000-0000-0000-0000000011b6', '00000000-0000-0000-0000-00000000b112', 'R11-GA-KG', 'kg');
update public.products set track_stock = true where id = '00000000-0000-0000-0000-00000000b112';
insert into public.inventory (sku_id, current_quantity) values ('00000000-0000-0000-0000-0000000011b6', 0);
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000011f1', $q$select public.get_purchasing_today()$q$)->>'awaiting_buying')::int = 1,
  'with garlic tracked at 0 kg, today''s order awaits buying');
update public.inventory set current_quantity = 5 where sku_id = '00000000-0000-0000-0000-0000000011b6';
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000011f1', $q$select public.get_purchasing_today()$q$)->>'awaiting_buying')::int = 0,
  'once the stock covers today, nothing awaits buying');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011d1', $q$select public.get_purchasing_today()$q$) like 'You do not have permission%', 'drivers cannot see purchasing counts');

-- ===========================================================================
-- NO-02: usual quantity = median of the last 10 qualifying orders, at least 3
-- ===========================================================================
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date)
select ('00000000-0000-0000-0000-0000000013' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000c111', 'phone', '00000000-0000-0000-0000-0000000011c1',
  (case when n = 6 then 'cancelled' when n = 7 then 'for_verification' else 'completed' end)::public.order_status, (select today - 30 + n from d)
from generate_series(1, 7) n;
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price)
select ('00000000-0000-0000-0000-0000000013' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000b112', q, 'kg', 200, 200, 150
from (values (1, 8), (2, 10), (3, 10), (4, 12), (5, 15), (6, 500), (7, 500)) v(n, q);
-- A different unit and a product with only two orders.
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price) values
  ('00000000-0000-0000-0000-000000001301', '00000000-0000-0000-0000-00000000b112', 1, 'sack', 2000, 2000, 1500),
  ('00000000-0000-0000-0000-000000001302', '00000000-0000-0000-0000-00000000b111', 5, 'kg', 100, 100, 70),
  ('00000000-0000-0000-0000-000000001303', '00000000-0000-0000-0000-00000000b111', 5, 'kg', 100, 100, 70);
insert into t values ('usual', pg_temp.run('00000000-0000-0000-0000-0000000011c1', $q$select jsonb_agg(to_jsonb(u)) from public.get_usual_quantities('00000000-0000-0000-0000-00000000c111') u$q$));
select pg_temp.ok((select (e->>'usual_quantity')::numeric = 10 and (e->>'order_count')::int = 5 from t, jsonb_array_elements(value) e where name = 'usual' and e->>'product_id' = '00000000-0000-0000-0000-00000000b112' and e->>'unit' = 'kg'),
  'garlic: median of 8, 10, 10, 12, 15 kg is 10 kg; cancelled and unverified orders are left out (NO-02)');
select pg_temp.ok(not exists (select 1 from t, jsonb_array_elements(value) e where name = 'usual' and e->>'unit' = 'sack'), 'another unit is not mixed in, and one sack order is not enough');
select pg_temp.ok(not exists (select 1 from t, jsonb_array_elements(value) e where name = 'usual' and e->>'product_id' = '00000000-0000-0000-0000-00000000b111' and e->>'order_count' = '2'),
  'fewer than 3 qualifying orders: no usual quantity');
-- Only the last 10 orders count.
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date)
select ('00000000-0000-0000-0000-0000000014' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000c111', 'phone', '00000000-0000-0000-0000-0000000011c1', 'completed', (select today - 10 + n from d)
from generate_series(1, 10) n;
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price)
select ('00000000-0000-0000-0000-0000000014' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000b112', 40, 'kg', 200, 200, 150 from generate_series(1, 10) n;
select pg_temp.ok((select (u->>'usual_quantity')::numeric = 40 and (u->>'order_count')::int = 10
  from jsonb_array_elements(pg_temp.run('00000000-0000-0000-0000-0000000011a1', $q$select jsonb_agg(to_jsonb(u)) from public.get_usual_quantities('00000000-0000-0000-0000-00000000c111') u$q$)) u
  where u->>'product_id' = '00000000-0000-0000-0000-00000000b112' and u->>'unit' = 'kg'), 'only the last 10 orders count');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011f1', $q$select public.get_usual_quantities('00000000-0000-0000-0000-00000000c111')$q$) like 'You do not have permission%', 'purchasing staff cannot read order history this way');

-- ===========================================================================
-- AS-03: push switches by role, saved per person
-- ===========================================================================
select pg_temp.ok((select public.push_categories_for_role('administrator') = array['new_orders', 'flagged_orders', 'delivery_reminders']
  and public.push_categories_for_role('administrative_staff') = array['new_orders', 'flagged_orders', 'delivery_reminders']
  and public.push_categories_for_role('fulfillment_staff') = array['ready_to_buy']
  and public.push_categories_for_role('delivery_staff') = array['delivery_reminders']), 'each role gets switches only for the alerts it already receives');
insert into t values ('step3', to_jsonb(pg_temp.err('00000000-0000-0000-0000-0000000011d1', $q$select public.set_my_push_preference('delivery_reminders', false)$q$)));
select pg_temp.ok((select value is null from t where name = 'step3')
  and (select not push_delivery_reminders and delivery_reminders from public.notification_preferences where user_id = '00000000-0000-0000-0000-0000000011d1'),
  'a driver turns off delivery pushes; in-app delivery reminders stay on');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011d1', $q$select public.set_my_push_preference('new_orders', false)$q$) = 'That switch is not available for your role', 'a driver has no new-order switch');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011f1', $q$select public.set_my_push_preference('delivery_reminders', false)$q$) = 'That switch is not available for your role', 'purchasing staff have no delivery switch');
-- Settings now has one Push notifications switch (prototype, 5 Nov; migration
-- 202611050007): the hidden per-event choice above no longer blocks a push.
select pg_temp.ok((select public.wants_push('00000000-0000-0000-0000-0000000011c1', 'order_requires_verification') and public.wants_push('00000000-0000-0000-0000-0000000011d1', 'upcoming_delivery')
  and not public.wants_push('00000000-0000-0000-0000-0000000011d1', 'order_requires_verification') and not public.wants_push('00000000-0000-0000-0000-0000000011f1', 'upcoming_delivery')),
  'the future sender follows each person''s role and the one push switch');
insert into t values ('step5', to_jsonb(pg_temp.err('00000000-0000-0000-0000-0000000011c1', $q$select public.set_my_notification_preferences(false)$q$)));
select pg_temp.ok((select value is null from t where name = 'step5')
  and (select push_delivery_reminders and not delivery_reminders from public.notification_preferences where user_id = '00000000-0000-0000-0000-0000000011c1'), 'and turning off in-app reminders leaves the push switch alone');

-- ===========================================================================
-- Customers (prototype, 5 Nov): administrator and office archive and restore;
-- purchasing cannot. New fields stay optional.
-- ===========================================================================
update public.customers set status = 'archived', archived_at = now() where id = '00000000-0000-0000-0000-00000000c112';
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011f1', $q$select public.set_customer_archived('00000000-0000-0000-0000-00000000c112', false, gen_random_uuid())$q$) = 'Only administrators and administrative staff can archive or restore customers', 'purchasing staff cannot restore a customer');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011a1', $q$select public.set_customer_archived('00000000-0000-0000-0000-00000000c112', false, gen_random_uuid())$q$) is null, 'the administrator restores it');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011c1', $q$select public.set_customer_archived('00000000-0000-0000-0000-00000000c112', true, gen_random_uuid())$q$) is null, 'administrative staff archive it too');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011c1', $q$select public.set_customer_archived('00000000-0000-0000-0000-00000000c112', false, gen_random_uuid())$q$) is null, 'and restore it');
insert into t values ('step4', to_jsonb(pg_temp.err('00000000-0000-0000-0000-0000000011c1', $q$select public.save_customer('00000000-0000-0000-0000-00000000c112', '{"customer_code":"R11-002","business_name":"Kusina Uno","business_type":"","preferred_delivery_window":""}', gen_random_uuid())$q$)));
select pg_temp.ok((select value is null from t where name = 'step4')
  and (select business_type is null and preferred_delivery_window is null from public.customers where id = '00000000-0000-0000-0000-00000000c112'), 'a customer saves with both new fields blank');
rollback;
