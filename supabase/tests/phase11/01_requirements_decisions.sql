-- Jac's 4 Nov decisions on the requirements document (Revision 2.1):
-- DE-04 completion, PU-01 bought quantities and HD-03 counts, NO-02 usual
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
-- DE-04: a driver must be assigned; then that driver or the administrator
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

select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011a1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000011f8', null, gen_random_uuid())$q$)
  = 'Assign a driver before marking this delivery delivered', 'not even the administrator can complete a stop with no driver (DE-04)');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011a1', $q$select public.offline_complete_delivery('00000000-0000-0000-0000-0000000011f8', null, gen_random_uuid(), jsonb_build_object('queued_at', now()))$q$)
  = 'Assign a driver before marking this delivery delivered', 'nor through offline sync');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011a1', $q$select public.update_delivery_status('00000000-0000-0000-0000-0000000011f8', 'completed', null)$q$)
  = 'Assign a driver before marking this delivery delivered', 'nor through the general delivery status action');
insert into t values ('step1', to_jsonb(pg_temp.err('00000000-0000-0000-0000-0000000011a1', $q$select public.transition_order_status('00000000-0000-0000-0000-0000000011e1', 'completed', null)$q$)));
select pg_temp.ok((select value is not null from t where name = 'step1')
  and (select status = 'for_delivery' from public.orders where id = '00000000-0000-0000-0000-0000000011e1'), 'nor through the general order status action');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011d2', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000011f9', null, gen_random_uuid())$q$) is not null, 'another driver cannot complete Rico''s stop');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011c1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000011f9', null, gen_random_uuid())$q$) is not null, 'administrative staff cannot complete it');
insert into t values ('step2', to_jsonb(pg_temp.err('00000000-0000-0000-0000-0000000011a1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000011f9', 'Mark', gen_random_uuid())$q$)));
select pg_temp.ok((select value is null from t where name = 'step2')
  and (select status = 'completed' from public.orders where id = '00000000-0000-0000-0000-0000000011e2'), 'once a driver is assigned, the administrator can complete it');
-- Assign Rico to the first stop: now he can complete it.
update public.deliveries set assigned_driver_id = '00000000-0000-0000-0000-0000000011d1' where id = '00000000-0000-0000-0000-0000000011f8';
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011d1', $q$select public.complete_delivery('00000000-0000-0000-0000-0000000011f8', null, gen_random_uuid())$q$) is null, 'the assigned driver completes their stop');

-- ===========================================================================
-- PU-01: bought quantities per product and delivery day
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

select pg_temp.ok((pg_temp.line('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d), 'R11 Onions')->>'quantity')::numeric = 45
  and (pg_temp.line('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d), 'R11 Onions')->>'remaining')::numeric = 45, 'three days need 45 kg of onions, none bought yet');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011c1', $q$select public.set_buy_list_bought('00000000-0000-0000-0000-00000000b111', 'kg', null, current_date, true, gen_random_uuid())$q$) like 'Only purchasing staff and administrators%', 'administrative staff cannot tick the buy list');

-- Purchasing ticks onions over the three days.
select pg_temp.run('00000000-0000-0000-0000-0000000011f1', format($q$select public.set_buy_list_bought('00000000-0000-0000-0000-00000000b111', 'kg', %L, %L, true, gen_random_uuid())$q$, (select today from d), (select today + 2 from d)));
select pg_temp.ok((select count(*) = 3 and sum(bought_quantity) = 45 from public.buy_list_purchases where product_id = '00000000-0000-0000-0000-00000000b111'), 'ticking saves the bought quantity for each of the three days (45 kg)');
select pg_temp.ok((pg_temp.line('00000000-0000-0000-0000-0000000011a1', (select today from d), (select today from d), 'R11 Onions')->>'remaining')::numeric = 0
  and (pg_temp.line('00000000-0000-0000-0000-0000000011a1', null, (select today + 1 from d), 'R11 Onions')->>'bought')::numeric = 30, 'other date filters read the same records, for the administrator too');
select pg_temp.ok((pg_temp.list('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d))->>'bought_lines')::int = 1
  and (pg_temp.list('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d))->>'total_lines')::int = 2, 'progress: 1 of 2 lines bought');
select pg_temp.ok((select (value->>'awaiting_buying')::int = 1 from (select pg_temp.run('00000000-0000-0000-0000-0000000011f1', 'select public.get_purchasing_today()') as value) x),
  'Purchasing Home: today''s order still awaits buying (garlic not bought)');

-- Demand on day 2 rises by 5 kg: 50 kg needed, 45 bought.
update public.order_items set quantity = 15 where id = '00000000-0000-0000-0000-0000000012a2';
select pg_temp.ok((pg_temp.line('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d), 'R11 Onions')->>'remaining')::numeric = 5
  and (pg_temp.line('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d), 'R11 Onions')->>'bought')::numeric = 45, 'demand rises to 50 kg: the line shows 5 kg still needed');
select pg_temp.ok((pg_temp.list('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d))->>'bought_lines')::int = 0, 'and it no longer counts as bought');
select pg_temp.ok((pg_temp.line('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today from d), 'R11 Onions')->>'remaining')::numeric = 0, 'today alone is still fully bought');
-- Ticking again tops it up to 50 kg.
select pg_temp.run('00000000-0000-0000-0000-0000000011f1', format($q$select public.set_buy_list_bought('00000000-0000-0000-0000-00000000b111', 'kg', %L, %L, true, gen_random_uuid())$q$, (select today from d), (select today + 2 from d)));
select pg_temp.ok((select sum(bought_quantity) = 50 from public.buy_list_purchases where product_id = '00000000-0000-0000-0000-00000000b111')
  and (pg_temp.line('00000000-0000-0000-0000-0000000011f1', (select today from d), (select today + 2 from d), 'R11 Onions')->>'remaining')::numeric = 0, 'ticking again brings the bought quantity to 50 kg');
-- Garlic bought: today's order no longer awaits buying.
select pg_temp.run('00000000-0000-0000-0000-0000000011a1', format($q$select public.set_buy_list_bought('00000000-0000-0000-0000-00000000b112', 'kg', null, %L, true, gen_random_uuid())$q$, (select today from d)));
select pg_temp.ok((select (value->>'awaiting_buying')::int = 0 and (value->>'awaiting_packing')::int = 1 from (select pg_temp.run('00000000-0000-0000-0000-0000000011f1', 'select public.get_purchasing_today()') as value) x),
  'Purchasing Home: nothing left to buy today, one order still to pack');
-- Unticking a range clears those days only.
select pg_temp.run('00000000-0000-0000-0000-0000000011f1', format($q$select public.set_buy_list_bought('00000000-0000-0000-0000-00000000b111', 'kg', %L, %L, false, gen_random_uuid())$q$, (select today + 2 from d), (select today + 2 from d)));
select pg_temp.ok((select count(*) = 2 from public.buy_list_purchases where product_id = '00000000-0000-0000-0000-00000000b111'), 'unticking one day keeps the other days');
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
select pg_temp.ok((select public.wants_push('00000000-0000-0000-0000-0000000011c1', 'order_requires_verification') and not public.wants_push('00000000-0000-0000-0000-0000000011d1', 'upcoming_delivery')
  and not public.wants_push('00000000-0000-0000-0000-0000000011d1', 'order_requires_verification') and not public.wants_push('00000000-0000-0000-0000-0000000011f1', 'upcoming_delivery')),
  'the future sender follows each person''s role and switches');
insert into t values ('step5', to_jsonb(pg_temp.err('00000000-0000-0000-0000-0000000011c1', $q$select public.set_my_notification_preferences(false)$q$)));
select pg_temp.ok((select value is null from t where name = 'step5')
  and (select push_delivery_reminders and not delivery_reminders from public.notification_preferences where user_id = '00000000-0000-0000-0000-0000000011c1'), 'and turning off in-app reminders leaves the push switch alone');

-- ===========================================================================
-- CU-01: restore is administrator-only; new fields stay optional
-- ===========================================================================
update public.customers set status = 'archived', archived_at = now() where id = '00000000-0000-0000-0000-00000000c112';
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011c1', $q$select public.set_customer_archived('00000000-0000-0000-0000-00000000c112', false, gen_random_uuid())$q$) = 'Only an administrator can archive or restore customers', 'administrative staff cannot restore a customer (CU-01)');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000011a1', $q$select public.set_customer_archived('00000000-0000-0000-0000-00000000c112', false, gen_random_uuid())$q$) is null, 'the administrator restores it');
insert into t values ('step4', to_jsonb(pg_temp.err('00000000-0000-0000-0000-0000000011c1', $q$select public.save_customer('00000000-0000-0000-0000-00000000c112', '{"customer_code":"R11-002","business_name":"Kusina Uno","business_type":"","preferred_delivery_window":""}', gen_random_uuid())$q$)));
select pg_temp.ok((select value is null from t where name = 'step4')
  and (select business_type is null and preferred_delivery_window is null from public.customers where id = '00000000-0000-0000-0000-00000000c112'), 'a customer saves with both new fields blank');
rollback;
