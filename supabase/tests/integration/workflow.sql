-- Integration review: one order from entry to report, across Phases 3 to 10,
-- with real role accounts, plus the offline paths (queued, replayed, refused).
-- Run by run_local.sh on the database it builds.
\set ON_ERROR_STOP 1
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if;
end $$;
create function pg_temp.call(uid uuid, sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  set local role authenticated;
  begin
    if sql ~* '^\s*insert' then execute sql; else execute sql into v; end if;
  exception when others then
    reset role;
    return jsonb_build_object('error', sqlstate || ' ' || sqlerrm);
  end;
  reset role;
  return coalesce(v, 'null'::jsonb);
end $$;
\set admin '''b0000000-0000-0000-0000-000000000001'''
\set office '''b0000000-0000-0000-0000-000000000002'''
\set packer '''b0000000-0000-0000-0000-000000000003'''
\set driver '''b0000000-0000-0000-0000-000000000004'''
\set driver2 '''b0000000-0000-0000-0000-000000000005'''
begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-000000000001', 'flow.admin@meah.test', '{"full_name":"Ana Mercado"}'),
  ('b0000000-0000-0000-0000-000000000002', 'flow.office@meah.test', '{"full_name":"Liza Ramos"}'),
  ('b0000000-0000-0000-0000-000000000003', 'flow.packer@meah.test', '{"full_name":"Carlo Diaz"}'),
  ('b0000000-0000-0000-0000-000000000004', 'flow.driver@meah.test', '{"full_name":"Rico Bautista"}'),
  ('b0000000-0000-0000-0000-000000000005', 'flow.driver2@meah.test', '{"full_name":"Jun Villanueva"}');
update public.profiles p set role = v.role::public.profile_role, status = 'active', must_change_password = false
  from (values ('b0000000-0000-0000-0000-000000000001'::uuid, 'administrator'), ('b0000000-0000-0000-0000-000000000002', 'administrative_staff'),
               ('b0000000-0000-0000-0000-000000000003', 'fulfillment_staff'), ('b0000000-0000-0000-0000-000000000004', 'delivery_staff'),
               ('b0000000-0000-0000-0000-000000000005', 'delivery_staff')) v(id, role)
  where p.id = v.id;
insert into public.customers (id, customer_code, business_name, delivery_address) values
  ('c0000000-0000-0000-0000-000000000001', 'FLOW-1', 'Casa Verde Restaurant', '12 Mabini St., Makati');
insert into public.products (id, product_name, unit_of_measurement) values
  ('d0000000-0000-0000-0000-000000000001', 'Tomatoes', 'kg'), ('d0000000-0000-0000-0000-000000000002', 'Cabbage', 'kg');
create temp table t (name text primary key, v jsonb);
grant all on t to authenticated;

-- Prices (Phase 8): the administrator sets them.
select pg_temp.ok(pg_temp.call(:admin, $q$select public.set_product_price('d0000000-0000-0000-0000-000000000001', 60, 85.55, gen_random_uuid())$q$) ? 'error' = false
  and pg_temp.call(:admin, $q$select public.set_product_price('d0000000-0000-0000-0000-000000000002', 40, 65.35, gen_random_uuid())$q$) ? 'error' = false, 'flow: the administrator sets today''s prices');

-- New order (Phase 4, sent through the Phase 10 path as the app does online).
insert into t select 'order', pg_temp.call(:office, format($q$select public.offline_create_order(%L, %L, 'e0000000-0000-4000-8000-000000000001', %L)$q$,
  jsonb_build_object('customer_id', 'c0000000-0000-0000-0000-000000000001', 'requested_delivery_date', current_date, 'order_source_id', (select id from public.order_sources where code = 'viber')),
  '[{"product_id":"d0000000-0000-0000-0000-000000000001","quantity":2.333,"unit_of_measurement":"kg"},{"product_id":"d0000000-0000-0000-0000-000000000002","quantity":1.257,"unit_of_measurement":"kg"}]',
  jsonb_build_object('queued_at', now(), 'seen_prices', '[{"product_id":"d0000000-0000-0000-0000-000000000001","unit":"kg","price":85.55},{"product_id":"d0000000-0000-0000-0000-000000000002","unit":"kg","price":65.35}]'::jsonb)));
select pg_temp.ok((select v ? 'order_id' from t where name = 'order'), 'flow: office staff save a new order');
create temp view o as select x from public.orders x where id = (select (v->>'order_id')::uuid from t where name = 'order');
grant select on o to authenticated;
select pg_temp.ok((select (x).status = 'confirmed' and (x).money_rounding = 'line' from o), 'flow: not flagged, so it is confirmed as it is saved, and rounds per line');
-- 2.333 x 85.55 = 199.58815 -> 199.59; 1.257 x 65.35 = 82.14495 -> 82.14
select pg_temp.ok((select public.order_subtotal(x) = 281.73 from o), 'flow: subtotal adds the rounded lines (199.59 + 82.14 = 281.73)');
select pg_temp.ok(pg_temp.call(:office, format($q$select public.apply_order_discount(%L, 'percent', 10, 'Loyal customer', gen_random_uuid())$q$, (select (x).id from o))) ? 'error' = false
  and pg_temp.call(:office, format($q$select public.set_sales_invoice_number(%L, 'SI-2001', null, gen_random_uuid())$q$, (select (x).id from o))) ? 'error' = false, 'flow: discount and SI number are added');
select pg_temp.ok((select public.order_discount(x) = 28.17 and public.order_total(x) = 253.56 from o), 'flow: 10% off 281.73 is 28.17, total 253.56');

-- Confirmed on save (prototype); queued offline confirms are covered in phase10.
select pg_temp.ok((select (x).status = 'confirmed' from o), 'flow: order confirmed');

-- Packing (Phase 5).
select pg_temp.ok(pg_temp.call(:packer, format($q$select public.start_packing(%L, gen_random_uuid())$q$, (select (x).id from o))) ? 'error' = false, 'flow: packing staff start packing');
select pg_temp.ok(pg_temp.call(:office, format($q$select public.issue_delivery_receipt(%L, gen_random_uuid())$q$, (select (x).id from o))) ? 'dr_number', 'flow: office staff print the delivery receipt while it is packed');
select pg_temp.ok(pg_temp.call(:packer, format($q$select public.offline_set_item_packed(%L, true, gen_random_uuid(), %L)$q$, i.id,
  jsonb_build_object('queued_at', now() - interval '10 minutes', 'seen', jsonb_build_object('packed', false, 'quantity', i.quantity, 'unit', i.unit_of_measurement)))) ? 'error' = false, 'flow: a line ticked offline is sent')
  from public.order_items i where i.order_id = (select (x).id from o);
select pg_temp.ok((select (x).status = 'for_delivery' from o), 'flow: all lines packed, order For delivery');

-- Delivery (Phase 6): scheduled, assigned, then reassigned while the first driver was offline.
insert into t select 'delivery', to_jsonb(public.create_delivery((select (x).id from o), current_date, null, 'b0000000-0000-0000-0000-000000000004', null))
  from (select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000002', true)) x;
select pg_temp.ok((select v is not null from t where name = 'delivery'), 'flow: office staff schedule the delivery for Rico');
create temp table first_seen as select (select (x).updated_at from o) as order_updated_at;
grant select on first_seen to authenticated;
select pg_temp.ok(pg_temp.call(:office, format($q$select public.assign_delivery_driver(%L, 'b0000000-0000-0000-0000-000000000005', gen_random_uuid())$q$, (select v #>> '{}' from t where name = 'delivery'))) ? 'error' = false, 'flow: the stop is moved to Jun');
insert into t select 'stale', pg_temp.call(:driver, format($q$select public.offline_complete_delivery(%L, 'Maria', 'e0000000-0000-4000-8000-000000000002', %L)$q$, (select v #>> '{}' from t where name = 'delivery'),
  jsonb_build_object('queued_at', now() - interval '5 minutes', 'seen', jsonb_build_object('scheduled_date', current_date, 'order_updated_at', (select order_updated_at from first_seen)))));
select pg_temp.ok((select v->>'error' like 'OFCON This stop was reassigned to Jun Villanueva%' from t where name = 'stale'), 'flow: Rico''s queued "delivered" is refused with the reason, not applied');
select pg_temp.ok(pg_temp.call(:driver, $q$insert into public.sync_rejections (request_id, action, rpc_name, kind, reason, queued_at) values ('e0000000-0000-4000-8000-000000000002', 'Mark delivered', 'offline_complete_delivery', 'conflict', 'This stop was reassigned', now()) on conflict (user_id, request_id) do nothing$q$) ? 'error' = false, 'flow: the refusal is recorded for the administrator, the way the app sends it (duplicates ignored)');
select pg_temp.ok((select jsonb_array_length(pg_temp.call(:admin, $q$select coalesce(jsonb_agg(reason), '[]') from public.sync_rejections$q$)) = 1), 'flow: the administrator sees it under Offline sync problems');
insert into t select 'done', pg_temp.call(:driver2, format($q$select public.offline_complete_delivery(%L, 'Maria Santos', 'e0000000-0000-4000-8000-000000000003', %L)$q$, (select v #>> '{}' from t where name = 'delivery'),
  jsonb_build_object('queued_at', now() - interval '1 minute', 'seen', jsonb_build_object('scheduled_date', current_date, 'order_updated_at', (select (x).updated_at from o)))));
select pg_temp.ok((select not v ? 'error' from t where name = 'done'), 'flow: Jun marks it delivered');
insert into t select 'done again', pg_temp.call(:driver2, format($q$select public.offline_complete_delivery(%L, 'Maria Santos', 'e0000000-0000-4000-8000-000000000003', %L)$q$, (select v #>> '{}' from t where name = 'delivery'),
  jsonb_build_object('queued_at', now() - interval '1 minute', 'seen', jsonb_build_object('scheduled_date', current_date, 'order_updated_at', (select order_updated_at from first_seen)))));
select pg_temp.ok((select a.v = b.v - 'replayed' and (b.v->>'replayed')::boolean from t a, t b where a.name = 'done' and b.name = 'done again'), 'flow: the same change sent again after a lost answer returns the first result');
select pg_temp.ok((select (x).status = 'completed' from o) and (select count(*) = 1 from public.order_activity where order_id = (select (x).id from o) and action = 'status_changed' and details->>'to_status' = 'completed'), 'flow: completed once');

-- Receipt (Phase 6): same DR number, money matches the order.
create temp view r as select * from public.delivery_receipts where order_id = (select (x).id from o);
select pg_temp.ok((select count(*) = 1 from r), 'flow: one receipt');
select pg_temp.ok((select (content->>'total')::numeric = 253.56 and (content->>'discount_amount')::numeric = 28.17 and content->>'sales_invoice_number' = 'SI-2001' from r), 'flow: the receipt shows the discount, total and SI number');
select pg_temp.ok((select sum((l->>'amount')::numeric) = (r.content->>'subtotal')::numeric from r, jsonb_array_elements(r.content->'lines') l group by r.content), 'flow: receipt lines add up to its subtotal');
select pg_temp.ok((select v->>'dr_label' = (select 'DR-' || lpad(dr_number::text, 4, '0') from r) from t where name = 'done'), 'flow: marking delivered returns the receipt printed earlier');

-- Reports (Phase 8): the administrator sees the same money.
select pg_temp.ok((select (e->>'total')::numeric = 253.56 from jsonb_array_elements(pg_temp.call(:admin, $q$select jsonb_agg(r) from public.get_order_report(current_date, current_date, null, null, 25, 0) r$q$)) e where (e->>'order_id')::uuid = (select (x).id from o)), 'flow: order report total matches');
select pg_temp.ok((select (pg_temp.call(:admin, $q$select public.get_sales_report(current_date, current_date)$q$) #>> '{totals,sales}')::numeric = 253.56), 'flow: sales report shows 253.56 for today');
select pg_temp.ok((select e->>'status' = 'completed' and e->>'driver_name' = 'Jun Villanueva' from jsonb_array_elements(pg_temp.call(:admin, $q$select jsonb_agg(r) from public.get_delivery_report(current_date, current_date) r$q$)) e where (e->>'order_id')::uuid = (select (x).id from o)), 'flow: delivery report shows who delivered it');
select pg_temp.ok((pg_temp.call(:office, $q$select public.get_sales_report(current_date, current_date)$q$) ->> 'error') like '42501 %', 'flow: office staff cannot open reports');

-- Offline new order whose price changed while queued, then sent at current prices.
-- (The test runs in one transaction, so move the first prices back to keep the two apart.)
update public.price_history set effective_from = effective_from - interval '1 day' where product_id in ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002');
select pg_temp.ok(pg_temp.call(:admin, $q$select public.set_product_price('d0000000-0000-0000-0000-000000000002', 40, 70, gen_random_uuid())$q$) ? 'error' = false, 'flow: cabbage price goes up while an order is queued');
create temp table q as select jsonb_build_object('customer_id', 'c0000000-0000-0000-0000-000000000001', 'requested_delivery_date', current_date + 1, 'order_source_id', (select id from public.order_sources where code = 'phone')) as ord,
  '[{"product_id":"d0000000-0000-0000-0000-000000000002","quantity":2,"unit_of_measurement":"kg"}]'::jsonb as items,
  jsonb_build_object('queued_at', now() - interval '2 days', 'seen_prices', '[{"product_id":"d0000000-0000-0000-0000-000000000002","unit":"kg","price":65.35}]'::jsonb) as off;
grant select on q to authenticated;
select pg_temp.ok((pg_temp.call(:office, $q$select public.offline_create_order(ord, items, 'e0000000-0000-4000-8000-000000000004', off) from q$q$) ->> 'error') like 'OFPRC %', 'flow: the queued order is held for a price review');
insert into t select 'accepted', pg_temp.call(:office, $q$select public.offline_create_order(ord, items, 'e0000000-0000-4000-8000-000000000004', off || '{"accept_current_prices":true}') from q$q$);
select pg_temp.ok((select public.order_total(x) = 140 from public.orders x where x.id = (select (v->>'order_id')::uuid from t where name = 'accepted')), 'flow: sent at current prices (2 x 70), same request id');
select pg_temp.ok((pg_temp.call(:office, $q$select public.offline_create_order(ord, items, 'e0000000-0000-4000-8000-000000000004', off) from q$q$) ->> 'order_id') = (select v->>'order_id' from t where name = 'accepted'), 'flow: a retry returns that order, not a second one');
rollback;
