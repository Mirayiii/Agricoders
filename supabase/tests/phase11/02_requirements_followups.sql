-- Jac's 4 Nov 17:21 decisions: no stock tag for office (SI-02, PS-02),
-- "Ready to buy" for purchasing (AS-02, AS-03), usual quantity without the
-- edited order (NO-02), VOID receipts for cancelled orders (DE-03).
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
  ('00000000-0000-0000-0000-0000000021a1', 'admin21@meah.test', '{"full_name":"Ana Admin"}'),
  ('00000000-0000-0000-0000-0000000021c1', 'office21@meah.test', '{"full_name":"Liza Office"}'),
  ('00000000-0000-0000-0000-0000000021f1', 'purchasing21@meah.test', '{"full_name":"Pia Purchasing"}'),
  ('00000000-0000-0000-0000-0000000021f2', 'purchasing21b@meah.test', '{"full_name":"Paolo Purchasing"}'),
  ('00000000-0000-0000-0000-0000000021f3', 'purchasing21c@meah.test', '{"full_name":"Former Purchasing"}'),
  ('00000000-0000-0000-0000-0000000021d1', 'driver21@meah.test', '{"full_name":"Rico Driver"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000021a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000021c1';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id in ('00000000-0000-0000-0000-0000000021f1', '00000000-0000-0000-0000-0000000021f2');
update public.profiles set status = 'inactive', role = 'fulfillment_staff' where id = '00000000-0000-0000-0000-0000000021f3';
update public.profiles set status = 'active', role = 'delivery_staff' where id = '00000000-0000-0000-0000-0000000021d1';

create temp table t (name text primary key, value jsonb) on commit drop;
grant all on t to authenticated;

insert into public.customers (id, customer_code, business_name) values
  ('00000000-0000-0000-0000-00000000c211', 'R21-001', 'Casa Verde'),
  ('00000000-0000-0000-0000-00000000c212', 'R21-002', 'Kusina Uno');
insert into public.products (id, product_name, unit_of_measurement) values
  ('00000000-0000-0000-0000-00000000b211', 'R21 Tomatoes', 'kg'),
  ('00000000-0000-0000-0000-00000000b212', 'R21 Carrots', 'kg');
insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by) values
  ('00000000-0000-0000-0000-00000000b211', 60, 85, now() - interval '1 day', '00000000-0000-0000-0000-0000000021a1'),
  ('00000000-0000-0000-0000-00000000b212', 70, 95, now() - interval '1 day', '00000000-0000-0000-0000-0000000021a1');
insert into public.product_skus (id, product_id, selling_sku, unit_of_measurement) values ('00000000-0000-0000-0000-0000000215c2', '00000000-0000-0000-0000-00000000b212', 'R21-CAR-KG', 'kg');
insert into public.inventory (sku_id, current_quantity) values ('00000000-0000-0000-0000-0000000215c2', 2);
update public.products set track_stock = true where id = '00000000-0000-0000-0000-00000000b212';

-- ===========================================================================
-- Prototype (5 Nov): office sees the New order stock tag again
-- ===========================================================================
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000021c1', $q$select to_jsonb(count(*)) from public.get_product_inventory_availability(array['00000000-0000-0000-0000-00000000b212'::uuid])$q$))::int = 1,
  'administrative staff get stock availability for the New order tag');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000021a1', $q$select to_jsonb(count(*)) from public.get_product_inventory_availability(array['00000000-0000-0000-0000-00000000b212'::uuid])$q$))::int = 1,
  'the administrator still gets it');
-- Track inventory off (Jac, 4 Nov): no stock tag at all, even for the administrator.
update public.products set track_stock = false where id = '00000000-0000-0000-0000-00000000b212';
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000021a1', $q$select to_jsonb(count(*)) from public.get_product_inventory_availability(array['00000000-0000-0000-0000-00000000b212'::uuid])$q$))::int = 0,
  'an untracked product gets no stock tag on New order, so it never reads Out of stock');
update public.products set track_stock = true where id = '00000000-0000-0000-0000-00000000b212';
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000021c1', $q$select to_jsonb(count(*)) from public.products where product_name like 'R21 %' and status = 'active'$q$))::int = 2,
  'administrative staff can still search products');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000021c1', $q$select to_jsonb(selling_price) from public.price_history where product_id = '00000000-0000-0000-0000-00000000b212' and effective_to is null$q$))::numeric = 95,
  'and see the selling price');
insert into t values ('office_order', pg_temp.run('00000000-0000-0000-0000-0000000021c1', $q$select public.create_order(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c211', 'requested_delivery_date', current_date + 1, 'order_source_id', (select id from public.order_sources where code = 'viber'),
    'requires_attention', true, 'attention_reason', 'Check stock'),
  '[{"product_id":"00000000-0000-0000-0000-00000000b212","quantity":5,"unit_of_measurement":"kg"}]'::jsonb, gen_random_uuid())$q$));
select pg_temp.ok((select o.status = 'for_verification' and i.quantity = 5 and i.unit_price = 95
  from t join public.orders o on o.id = (t.value->>'order_id')::uuid join public.order_items i on i.order_id = o.id where t.name = 'office_order'),
  'and submit an order for more than is in stock (5 kg, 2 kg on hand), at the list price');

-- ===========================================================================
-- AS-02 / AS-03: "Ready to buy" for purchasing staff
-- ===========================================================================
select pg_temp.ok(not exists (select 1 from public.notifications where type = 'ready_to_buy'), 'a new order for verification does not notify purchasing');
-- The office checks it and clears the flag, then confirms.
update public.orders set requires_attention = false, attention_reason = null where id = (select (value->>'order_id')::uuid from t where name = 'office_order');
insert into t values ('confirm_id', to_jsonb(gen_random_uuid()));
select pg_temp.run('00000000-0000-0000-0000-0000000021c1', format($q$select public.offline_confirm_order(%L, %L, jsonb_build_object('queued_at', now()))$q$,
  (select value->>'order_id' from t where name = 'office_order'), (select value #>> '{}' from t where name = 'confirm_id')));
select pg_temp.ok((select count(*) = 2 and bool_and(n.related_order_id = (t.value->>'order_id')::uuid and n.title = 'Ready to buy' and not n.is_read)
  from public.notifications n, t where t.name = 'office_order' and n.type = 'ready_to_buy'),
  'confirming sends one "Ready to buy" to each active purchasing staff member, linked to the order');
select pg_temp.ok(not exists (select 1 from public.notifications where type = 'ready_to_buy'
  and user_id in ('00000000-0000-0000-0000-0000000021f3', '00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021c1', '00000000-0000-0000-0000-0000000021d1')),
  'not to inactive purchasing accounts, the office, the administrator or drivers');
-- The same confirmation retried (same request id): replayed, nothing new.
select pg_temp.run('00000000-0000-0000-0000-0000000021c1', format($q$select public.offline_confirm_order(%L, %L, jsonb_build_object('queued_at', now()))$q$,
  (select value->>'order_id' from t where name = 'office_order'), (select value #>> '{}' from t where name = 'confirm_id')));
select pg_temp.ok((select count(*) = 2 from public.notifications where type = 'ready_to_buy'), 'retrying the same confirmation sends nothing new');
-- Even if the order went back to verification and was confirmed again.
update public.orders set status = 'for_verification' where id = (select (value->>'order_id')::uuid from t where name = 'office_order');
update public.orders set status = 'confirmed' where id = (select (value->>'order_id')::uuid from t where name = 'office_order');
select pg_temp.ok((select count(*) = 2 from public.notifications where type = 'ready_to_buy'), 'a second confirmation of the same order sends no duplicate');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000021f1', $q$select to_jsonb(count(*)) from public.notifications where type = 'ready_to_buy'$q$))::int = 1,
  'purchasing staff read their own notification');
-- Push switch: saved per person, and the in-app notification does not depend on it.
insert into t values ('push_off', to_jsonb(pg_temp.err('00000000-0000-0000-0000-0000000021f1', $q$select public.set_my_push_preference('ready_to_buy', false)$q$)));
select pg_temp.ok((select value is null from t where name = 'push_off')
  and public.wants_push('00000000-0000-0000-0000-0000000021f1', 'ready_to_buy')
  and public.wants_push('00000000-0000-0000-0000-0000000021f2', 'ready_to_buy'), 'an old app can still save the hidden "Ready to buy" choice, but only the Push notifications switch decides now (202611050007)');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000021c1', $q$select public.set_my_push_preference('ready_to_buy', false)$q$) = 'That switch is not available for your role',
  'office staff have no "Ready to buy" switch');
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000021e9', '00000000-0000-0000-0000-00000000c212', 'phone', '00000000-0000-0000-0000-0000000021c1', 'for_verification', current_date + 2);
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price) values
  ('00000000-0000-0000-0000-0000000021e9', '00000000-0000-0000-0000-00000000b211', 3, 'kg', 85, 85, 60);
select pg_temp.run('00000000-0000-0000-0000-0000000021a1', $q$select public.offline_confirm_order('00000000-0000-0000-0000-0000000021e9', gen_random_uuid(), jsonb_build_object('queued_at', now()))$q$);
select pg_temp.ok(exists (select 1 from public.notifications where type = 'ready_to_buy' and user_id = '00000000-0000-0000-0000-0000000021f1' and related_order_id = '00000000-0000-0000-0000-0000000021e9'),
  'with the push switch off, the in-app notification still arrives');

-- ===========================================================================
-- NO-02: the order being edited is left out of its own history
-- ===========================================================================
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date)
select ('00000000-0000-0000-0000-0000000022' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000c212', 'phone', '00000000-0000-0000-0000-0000000021c1', 'completed', current_date - 20 + n
from generate_series(1, 4) n;
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price)
select ('00000000-0000-0000-0000-0000000022' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-00000000b212', q, 'kg', 95, 95, 70
from (values (1, 10), (2, 10), (3, 10), (4, 40)) v(n, q);
-- The order being edited: confirmed, 40 kg.
create function pg_temp.usual(exclude uuid) returns numeric language sql as $$
  select (u->>'usual_quantity')::numeric from jsonb_array_elements(pg_temp.run('00000000-0000-0000-0000-0000000021c1',
    format($q$select coalesce(jsonb_agg(to_jsonb(u)), '[]') from public.get_usual_quantities('00000000-0000-0000-0000-00000000c212', %L) u$q$, exclude))) u
  where u->>'product_id' = '00000000-0000-0000-0000-00000000b212' and u->>'unit' = 'kg';
$$;
select pg_temp.ok(pg_temp.usual(null) = 10, 'usual carrots with all four orders (10, 10, 10, 40 kg): median 10 kg');
select pg_temp.ok(pg_temp.usual('00000000-0000-0000-0000-000000002204') = 10, 'leaving out the edited 40 kg order: still 10 kg from the other three');
update public.order_items set quantity = 10 where order_id = '00000000-0000-0000-0000-000000002203';
update public.order_items set quantity = 40 where order_id in ('00000000-0000-0000-0000-000000002202');
-- Now 10, 40, 10, 40: median 25 with it, 10 without the edited order.
select pg_temp.ok(pg_temp.usual(null) = 25 and pg_temp.usual('00000000-0000-0000-0000-000000002204') = 10, 'the edited order does not raise its own usual quantity (25 kg with it, 10 kg without)');
select pg_temp.ok(pg_temp.usual('00000000-0000-0000-0000-000000002201') = 40, 'leaving out a different order uses the other three (40, 10, 40 kg: 40 kg)');
delete from public.order_items where order_id = '00000000-0000-0000-0000-000000002203';
select pg_temp.ok(pg_temp.usual('00000000-0000-0000-0000-000000002204') is null, 'with only 2 other orders left, there is no usual quantity and no warning');

-- ===========================================================================
-- DE-03: a cancelled order's receipt is marked VOID
-- ===========================================================================
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000023e1', '00000000-0000-0000-0000-00000000c211', 'phone', '00000000-0000-0000-0000-0000000021c1', 'confirmed', current_date + 1),
  ('00000000-0000-0000-0000-0000000023e2', '00000000-0000-0000-0000-00000000c211', 'phone', '00000000-0000-0000-0000-0000000021c1', 'confirmed', current_date + 1),
  ('00000000-0000-0000-0000-0000000023e3', '00000000-0000-0000-0000-00000000c211', 'phone', '00000000-0000-0000-0000-0000000021c1', 'confirmed', current_date + 1);
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price)
select o, '00000000-0000-0000-0000-00000000b211', 4, 'kg', 85, 85, 60
from unnest(array['00000000-0000-0000-0000-0000000023e1', '00000000-0000-0000-0000-0000000023e2', '00000000-0000-0000-0000-0000000023e3']::uuid[]) o;
select pg_temp.run('00000000-0000-0000-0000-0000000021c1', $q$select public.issue_delivery_receipt('00000000-0000-0000-0000-0000000023e1', gen_random_uuid())$q$);
insert into t select 'dr1', to_jsonb(dr_number) from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000023e1';
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000021c1', $q$select public.transition_order_status('00000000-0000-0000-0000-0000000023e1', 'cancelled', '{"reason":"Customer called off"}'::jsonb)$q$) is null, 'office cancels an order that has a receipt');
select pg_temp.ok((select voided_at is not null and finalized_at is not null and dr_number = (select (value #>> '{}')::bigint from t where name = 'dr1')
  from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000023e1'), 'cancelling marks the receipt void, with the same DR number');
insert into t values ('void1', pg_temp.run('00000000-0000-0000-0000-0000000021c1', $q$select public.get_delivery_receipt('00000000-0000-0000-0000-0000000023e1')$q$));
select pg_temp.ok((select value->>'voided_at' is not null and (value->'content'->>'total')::numeric = 340 from t where name = 'void1'),
  'downloads say it is void and keep the details (4 kg at 85 = 340)');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000021c1', $q$select public.issue_delivery_receipt('00000000-0000-0000-0000-0000000023e1', gen_random_uuid())$q$) is not null,
  'a cancelled order cannot get a new receipt');
select pg_temp.ok((select count(*) = 1 from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000023e1'), 'still one receipt for that order');
select pg_temp.ok(exists (select 1 from public.order_activity where order_id = '00000000-0000-0000-0000-0000000023e1' and action = 'receipt_voided'), 'the void is recorded on the order history');
do $$ begin
  update public.delivery_receipts set voided_at = null where order_id = '00000000-0000-0000-0000-0000000023e1';
  raise exception 'FAIL a void receipt was un-voided';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS a void receipt cannot be un-voided or changed';
end $$;
-- No receipt, no void.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000021c1', $q$select public.transition_order_status('00000000-0000-0000-0000-0000000023e2', 'cancelled', '{"reason":"Duplicate"}'::jsonb)$q$) is null, 'office cancels an order without a receipt');
select pg_temp.ok(not exists (select 1 from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000023e2')
  and (pg_temp.run('00000000-0000-0000-0000-0000000021c1', $q$select public.get_delivery_receipt('00000000-0000-0000-0000-0000000023e2')$q$)) is null,
  'cancelling an order without a receipt does not create one');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000021c1', $q$select public.issue_delivery_receipt('00000000-0000-0000-0000-0000000023e2', gen_random_uuid())$q$) is not null,
  'and no receipt can be issued for it afterwards');
-- An order cancelled before this change, with a receipt: void once the migration runs.
select pg_temp.run('00000000-0000-0000-0000-0000000021c1', $q$select public.issue_delivery_receipt('00000000-0000-0000-0000-0000000023e3', gen_random_uuid())$q$);
alter table public.orders disable trigger orders_void_receipt_on_cancel;
update public.orders set status = 'cancelled' where id = '00000000-0000-0000-0000-0000000023e3';
alter table public.orders enable trigger orders_void_receipt_on_cancel;
insert into t select 'dr3', to_jsonb(dr_number) from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000023e3';
select pg_temp.ok((select voided_at is null from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000023e3'), 'set-up: an older cancelled order whose receipt is not void');
\ir ../../migrations/202611040003_requirements_followups.sql
select pg_temp.ok((select voided_at is not null and finalized_at is not null and dr_number = (select (value #>> '{}')::bigint from t where name = 'dr3')
  from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000023e3'), 'the migration voids receipts of orders cancelled earlier, same DR number');
-- ===========================================================================
-- DE-04 go-live check: the read-only query runs and finds unassigned stops
-- ===========================================================================
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000024e1', '00000000-0000-0000-0000-00000000c211', 'phone', '00000000-0000-0000-0000-0000000021c1', 'for_delivery', current_date);
insert into public.deliveries (order_id, assigned_driver_id, scheduled_date, status) values
  ('00000000-0000-0000-0000-0000000024e1', null, current_date, 'for_delivery');
\o /dev/null
\ir ../../go-live/requirements/01_unassigned_out_for_delivery.sql
\o
select pg_temp.ok(exists (select 1 from public.deliveries d join public.orders o on o.id = d.order_id
  where d.assigned_driver_id is null and d.status not in ('completed', 'cancelled') and o.order_number is not null and o.id = '00000000-0000-0000-0000-0000000024e1'),
  'the go-live query for unassigned stops runs (read-only)');
rollback;
