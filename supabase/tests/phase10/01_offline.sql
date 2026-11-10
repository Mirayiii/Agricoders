-- Phase 10 offline replay: duplicates, expiry, version and assignment checks, price review, rejections log.
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

create function pg_temp.code(uid uuid, sql text) returns text language plpgsql as $$
begin
  perform pg_temp.as_user(uid);
  set local role authenticated;
  begin
    execute sql;
  exception when others then
    reset role;
    return sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  return null;
end $$;
create function pg_temp.off(days int default 0, seen jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('queued_at', now() - make_interval(days => days), 'seen', seen);
$$;

begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000aa1', 'admin10@meah.test', '{"full_name":"Ana Mercado"}'),
  ('00000000-0000-0000-0000-000000000ac1', 'office10@meah.test', '{"full_name":"Liza Ramos"}'),
  ('00000000-0000-0000-0000-000000000af1', 'purch10@meah.test', '{"full_name":"Carlo Diaz"}'),
  ('00000000-0000-0000-0000-000000000af2', 'purch10b@meah.test', '{"full_name":"Nina Gomez"}'),
  ('00000000-0000-0000-0000-000000000ad1', 'driver10@meah.test', '{"full_name":"Rico Bautista"}'),
  ('00000000-0000-0000-0000-000000000ad2', 'driver10b@meah.test', '{"full_name":"Jun Villanueva"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-000000000aa1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-000000000ac1';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id in ('00000000-0000-0000-0000-000000000af1', '00000000-0000-0000-0000-000000000af2');
update public.profiles set status = 'active', role = 'delivery_staff' where id in ('00000000-0000-0000-0000-000000000ad1', '00000000-0000-0000-0000-000000000ad2');

insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-000000000ac0', 'P10-001', 'Casa Verde');
insert into public.products (id, product_name, unit_of_measurement) values ('00000000-0000-0000-0000-000000000ab1', 'Tomatoes', 'kg'), ('00000000-0000-0000-0000-000000000ab2', 'Carrots', 'kg');
insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by) values
  ('00000000-0000-0000-0000-000000000ab1', 60, 85, now() - interval '2 days', '00000000-0000-0000-0000-000000000aa1'),
  ('00000000-0000-0000-0000-000000000ab2', 70, 95, now() - interval '2 days', '00000000-0000-0000-0000-000000000aa1');

-- e1, e4, e5: packed and out for delivery. e2: being packed. e3: waiting for verification.
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-000000000ae1', '00000000-0000-0000-0000-000000000ac0', 'phone', '00000000-0000-0000-0000-000000000ac1', 'for_delivery', current_date),
  ('00000000-0000-0000-0000-000000000ae2', '00000000-0000-0000-0000-000000000ac0', 'phone', '00000000-0000-0000-0000-000000000ac1', 'for_preparation', current_date + 1),
  ('00000000-0000-0000-0000-000000000ae3', '00000000-0000-0000-0000-000000000ac0', 'phone', '00000000-0000-0000-0000-000000000ac1', 'for_verification', current_date + 2),
  ('00000000-0000-0000-0000-000000000ae4', '00000000-0000-0000-0000-000000000ac0', 'phone', '00000000-0000-0000-0000-000000000ac1', 'for_delivery', current_date),
  ('00000000-0000-0000-0000-000000000ae5', '00000000-0000-0000-0000-000000000ac0', 'phone', '00000000-0000-0000-0000-000000000ac1', 'for_delivery', current_date);
insert into public.order_items (id, order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price) values
  ('00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-000000000ae1', '00000000-0000-0000-0000-000000000ab1', 2, 'kg', 85, 85, 60),
  ('00000000-0000-0000-0000-0000000001e2', '00000000-0000-0000-0000-000000000ae2', '00000000-0000-0000-0000-000000000ab1', 3, 'kg', 85, 85, 60),
  ('00000000-0000-0000-0000-0000000002e2', '00000000-0000-0000-0000-000000000ae2', '00000000-0000-0000-0000-000000000ab2', 4, 'kg', 95, 95, 70),
  ('00000000-0000-0000-0000-0000000003e2', '00000000-0000-0000-0000-000000000ae2', '00000000-0000-0000-0000-000000000ab2', 1, 'kg', 95, 95, 70),
  ('00000000-0000-0000-0000-0000000001e3', '00000000-0000-0000-0000-000000000ae3', '00000000-0000-0000-0000-000000000ab1', 1, 'kg', 85, 85, 60),
  ('00000000-0000-0000-0000-0000000001e4', '00000000-0000-0000-0000-000000000ae4', '00000000-0000-0000-0000-000000000ab1', 1, 'kg', 85, 85, 60),
  ('00000000-0000-0000-0000-0000000001e5', '00000000-0000-0000-0000-000000000ae5', '00000000-0000-0000-0000-000000000ab1', 1, 'kg', 85, 85, 60);
insert into public.deliveries (id, order_id, assigned_driver_id, scheduled_date) values
  ('00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-000000000ae1', '00000000-0000-0000-0000-000000000ad1', current_date),
  ('00000000-0000-0000-0000-0000000001d4', '00000000-0000-0000-0000-000000000ae4', '00000000-0000-0000-0000-000000000ad2', current_date),
  ('00000000-0000-0000-0000-0000000001d5', '00000000-0000-0000-0000-000000000ae5', '00000000-0000-0000-0000-000000000ad1', current_date);

create temp table seen on commit drop as
  select 'e1'::text as name, (select updated_at from public.orders where id = '00000000-0000-0000-0000-000000000ae1') as at
  union all select 'e3', (select updated_at from public.orders where id = '00000000-0000-0000-0000-000000000ae3')
  union all select 'e5', (select updated_at from public.orders where id = '00000000-0000-0000-0000-000000000ae5');
grant all on seen to authenticated;
create temp table t (name text primary key, value jsonb) on commit drop;
grant all on t to authenticated;

-- ---------------------------------------------------------------------------
-- Mark delivered
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad1', format($q$select public.offline_complete_delivery('00000000-0000-0000-0000-0000000001d1', 'Mark', '10000000-0000-4000-8000-000000000001', %L)$q$,
  pg_temp.off(31, jsonb_build_object('scheduled_date', current_date)))) like 'OFEXP %more than 30 days ago%', 'a change queued more than 30 days ago is refused, not replayed');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad1', format($q$select public.offline_complete_delivery('00000000-0000-0000-0000-0000000001d4', 'Mark', '10000000-0000-4000-8000-000000000002', %L)$q$,
  pg_temp.off(0))) = 'OFCON This stop was reassigned to Jun Villanueva, so it was not marked delivered.', 'a stop reassigned to another driver is refused with the reason');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad1', format($q$select public.offline_complete_delivery('00000000-0000-0000-0000-0000000001d1', 'Mark', '10000000-0000-4000-8000-000000000003', %L)$q$,
  pg_temp.off(0, jsonb_build_object('scheduled_date', current_date - 1)))) like 'OFCON This stop was moved to %', 'a rescheduled stop is refused');
update public.orders set notes = 'Changed by the office' where id = '00000000-0000-0000-0000-000000000ae5';
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad1', format($q$select public.offline_complete_delivery('00000000-0000-0000-0000-0000000001d5', 'Mark', '10000000-0000-4000-8000-000000000004', %L)$q$,
  pg_temp.off(0, jsonb_build_object('scheduled_date', current_date, 'order_updated_at', now() - interval '1 hour')))) like 'OFCON The order was changed after your list was last updated%', 'an order changed after the driver last saw it is refused, not overwritten');
select pg_temp.ok((select status = 'scheduled' from public.deliveries where id = '00000000-0000-0000-0000-0000000001d5'), 'a refused change leaves the stop as it was');

select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad1', format($q$insert into t select 'd1', public.offline_complete_delivery('00000000-0000-0000-0000-0000000001d1', 'Mark', '10000000-0000-4000-8000-000000000005', %L)$q$,
  pg_temp.off(29, jsonb_build_object('scheduled_date', current_date, 'order_updated_at', (select at from seen where name = 'e1'))))) is null, 'runs: a 29-day-old queued delivery is sent');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad1', format($q$insert into t select 'd1 again', public.offline_complete_delivery('00000000-0000-0000-0000-0000000001d1', 'Mark', '10000000-0000-4000-8000-000000000005', %L)$q$,
  pg_temp.off(29, jsonb_build_object('scheduled_date', current_date, 'order_updated_at', (select at from seen where name = 'e1'))))) is null, 'runs: the same queued delivery is sent again');
select pg_temp.ok((select status = 'completed' and received_by = 'Mark' from public.deliveries where id = '00000000-0000-0000-0000-0000000001d1')
  and (select value->>'replayed' = 'true' and value->>'delivery_id' = '00000000-0000-0000-0000-0000000001d1' from t where name = 'd1 again')
  and (select count(*) from public.order_activity where order_id = '00000000-0000-0000-0000-000000000ae1' and details->>'to_status' = 'completed' and action = 'delivery_status_changed') = 1,
  'a duplicate replay returns the first result and changes nothing again');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad1', format($q$select public.offline_complete_delivery('00000000-0000-0000-0000-0000000001d1', 'Someone else', '10000000-0000-4000-8000-000000000005', %L)$q$, pg_temp.off(0))) like '% request_id_reused', 'the same request id with different details is refused');

-- Deactivated: queued actions are refused on sync.
update public.profiles set status = 'inactive' where id = '00000000-0000-0000-0000-000000000ad2';
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad2', format($q$select public.offline_complete_delivery('00000000-0000-0000-0000-0000000001d4', null, '10000000-0000-4000-8000-000000000006', %L)$q$, pg_temp.off(0))) like '42501 %', 'a deactivated driver''s queued delivery is refused as a permission error');
update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-000000000ad2';

-- ---------------------------------------------------------------------------
-- Tick packed
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000af1', $q$insert into t select 'p1', public.offline_set_item_packed('00000000-0000-0000-0000-0000000001e2', true, '20000000-0000-4000-8000-000000000001', pg_temp.off(1, '{"packed":false,"quantity":3,"unit":"kg"}'))$q$) is null, 'runs: a queued tick is sent');
select pg_temp.ok((select preparation_status = 'completed' and prepared_by = '00000000-0000-0000-0000-000000000af1' from public.order_items where id = '00000000-0000-0000-0000-0000000001e2'), 'the line is packed by the person who ticked it');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000af1', $q$insert into t select 'p1 again', public.offline_set_item_packed('00000000-0000-0000-0000-0000000001e2', true, '20000000-0000-4000-8000-000000000001', pg_temp.off(1, '{"packed":false,"quantity":3,"unit":"kg"}'))$q$) is null, 'runs: the same tick is sent again');
select pg_temp.ok((select value->>'replayed' = 'true' from t where name = 'p1 again'), 'a duplicate tick returns the first result');
-- Nina saw the line unticked and queued "untick"? No: she saw it unpacked and Carlo ticked it since. Her queued untick must not undo his newer tick.
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000af2', $q$select public.offline_set_item_packed('00000000-0000-0000-0000-0000000001e2', false, '20000000-0000-4000-8000-000000000002', pg_temp.off(0, '{"packed":false,"quantity":3,"unit":"kg"}'))$q$)
  = 'OFCON Tomatoes was ticked packed by Carlo Diaz after your list was last updated, so your change was not applied.', 'a queued change never undoes someone else''s newer change');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000af2', $q$select public.offline_set_item_packed('00000000-0000-0000-0000-0000000002e2', true, '20000000-0000-4000-8000-000000000003', pg_temp.off(0, '{"packed":false,"quantity":2,"unit":"kg"}'))$q$)
  = 'OFCON Carrots changed to 4 kg after your list was last updated. Check it before packing.', 'a line whose quantity changed is refused for review');
delete from public.order_items where id = '00000000-0000-0000-0000-0000000003e2';
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000af2', $q$select public.offline_set_item_packed('00000000-0000-0000-0000-0000000003e2', true, '20000000-0000-4000-8000-000000000004', pg_temp.off(0, '{"packed":false,"quantity":1,"unit":"kg"}'))$q$)
  like 'OFCON This item was removed from the order%', 'a removed line is refused');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad1', $q$select public.offline_set_item_packed('00000000-0000-0000-0000-0000000002e2', true, '20000000-0000-4000-8000-000000000005', pg_temp.off(0))$q$) like '42501 %', 'delivery staff cannot pack');

-- ---------------------------------------------------------------------------
-- Confirm order
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ac1', format($q$select public.offline_confirm_order('00000000-0000-0000-0000-000000000ae3', '30000000-0000-4000-8000-000000000001', %L)$q$,
  pg_temp.off(0, jsonb_build_object('updated_at', now() - interval '1 hour')))) is null = false, 'an order changed after it was last seen is not confirmed');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ac1', format($q$select public.offline_confirm_order('00000000-0000-0000-0000-000000000ae3', '30000000-0000-4000-8000-000000000002', %L)$q$,
  pg_temp.off(0, jsonb_build_object('updated_at', (select at from seen where name = 'e3'))))) is null, 'runs: a queued confirm is sent');
select pg_temp.ok((select status = 'confirmed' from public.orders where id = '00000000-0000-0000-0000-000000000ae3'), 'the order is confirmed');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000aa1', format($q$select public.offline_confirm_order('00000000-0000-0000-0000-000000000ae3', '30000000-0000-4000-8000-000000000003', %L)$q$, pg_temp.off(0)))
  = 'OFCON This order is already confirmed, so it was not confirmed again.', 'a second person''s queued confirm is refused with the reason');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000af1', format($q$select public.offline_confirm_order('00000000-0000-0000-0000-000000000ae3', '30000000-0000-4000-8000-000000000004', %L)$q$, pg_temp.off(0))) like '42501 %', 'purchasing staff cannot confirm orders');

-- ---------------------------------------------------------------------------
-- New order with a price review
-- ---------------------------------------------------------------------------
create temp table base on commit drop as select count(*) as orders from public.orders;
create function pg_temp.new_order() returns jsonb language sql as $$
  select jsonb_build_object('customer_id', '00000000-0000-0000-0000-000000000ac0', 'requested_delivery_date', current_date + 1, 'order_source_id', (select id from public.order_sources where code = 'viber'));
$$;
-- Tomatoes was 80 when the order was entered offline; it is 85 now.
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ac1', $q$select public.offline_create_order(pg_temp.new_order(), '[{"product_id":"00000000-0000-0000-0000-000000000ab1","quantity":2,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-000000000ab2","quantity":1,"unit_of_measurement":"kg"}]', '40000000-0000-4000-8000-000000000001',
  jsonb_build_object('queued_at', now(), 'seen_prices', '[{"product_id":"00000000-0000-0000-0000-000000000ab1","unit":"kg","price":80},{"product_id":"00000000-0000-0000-0000-000000000ab2","unit":"kg","price":95}]'::jsonb))$q$) = 'OFPRC Prices changed since this order was entered', 'a queued order whose prices changed is held for review');
select pg_temp.ok((select count(*) from public.orders) = (select orders from base)
  and not exists (select 1 from public.mutation_requests where request_id in ('40000000-0000-4000-8000-000000000001', public.offline_inner_request_id('40000000-0000-4000-8000-000000000001'))),
  'a held order saves nothing, so it can be sent again after review');
do $$
declare v_detail text;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000ac1');
  begin
    perform public.offline_create_order(pg_temp.new_order(), '[{"product_id":"00000000-0000-0000-0000-000000000ab1","quantity":2,"unit_of_measurement":"kg"}]', gen_random_uuid(),
      jsonb_build_object('queued_at', now(), 'seen_prices', '[{"product_id":"00000000-0000-0000-0000-000000000ab1","unit":"kg","price":80}]'::jsonb));
  exception when sqlstate 'OFPRC' then
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  perform pg_temp.ok(v_detail::jsonb = '[{"unit": "kg", "product_id": "00000000-0000-0000-0000-000000000ab1", "seen_price": 80, "product_name": "Tomatoes", "current_price": 85.00}]'::jsonb, 'the review lists each changed line with the old and new price');
end $$;
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ac1', $q$insert into t select 'o1', public.offline_create_order(pg_temp.new_order(), '[{"product_id":"00000000-0000-0000-0000-000000000ab1","quantity":2,"unit_of_measurement":"kg"}]', '40000000-0000-4000-8000-000000000001',
  jsonb_build_object('queued_at', now(), 'accept_current_prices', true, 'seen_prices', '[{"product_id":"00000000-0000-0000-0000-000000000ab1","unit":"kg","price":80}]'::jsonb))$q$) is null, 'runs: after review the order is sent at today''s prices');
select pg_temp.ok((select (value->>'total')::numeric = 170 from t where name = 'o1') and (select count(*) from public.orders) = (select orders from base) + 1, 'it is saved once, at the current price');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ac1', $q$insert into t select 'o1 again', public.offline_create_order(pg_temp.new_order(), '[{"product_id":"00000000-0000-0000-0000-000000000ab1","quantity":2,"unit_of_measurement":"kg"}]', '40000000-0000-4000-8000-000000000001',
  jsonb_build_object('queued_at', now(), 'accept_current_prices', true))$q$) is null, 'runs: the same new order is sent again');
select pg_temp.ok((select value->>'replayed' = 'true' from t where name = 'o1 again') and (select count(*) from public.orders) = (select orders from base) + 1, 'a duplicate replay of a new order creates nothing new');
-- A saved order whose answer was lost is replayed even if the retry is sent without "accept" and with the old prices.
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ac1', $q$insert into t select 'o1 lost answer', public.offline_create_order(pg_temp.new_order(), '[{"product_id":"00000000-0000-0000-0000-000000000ab1","quantity":2,"unit_of_measurement":"kg"}]', '40000000-0000-4000-8000-000000000001',
  jsonb_build_object('queued_at', now(), 'seen_prices', '[{"product_id":"00000000-0000-0000-0000-000000000ab1","unit":"kg","price":80}]'::jsonb))$q$) is null, 'runs: a retry after a lost answer');
select pg_temp.ok((select value->>'replayed' = 'true' from t where name = 'o1 lost answer') and (select count(*) from public.orders) = (select orders from base) + 1, 'a retry of a saved order returns the first result, not a price review or a second order');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ac1', $q$select public.offline_create_order(pg_temp.new_order(), '[{"product_id":"00000000-0000-0000-0000-000000000ab2","quantity":1,"unit_of_measurement":"kg"}]', gen_random_uuid(),
  jsonb_build_object('queued_at', now(), 'seen_prices', '[{"product_id":"00000000-0000-0000-0000-000000000ab2","unit":"kg","price":95}]'::jsonb))$q$) is null, 'an order with unchanged prices is saved without review');

-- ---------------------------------------------------------------------------
-- Rejections log (D-OF4) and retention (D-OF3)
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad1', $q$insert into public.sync_rejections (request_id, action, rpc_name, kind, reason, queued_at) values ('10000000-0000-4000-8000-000000000002', 'Mark delivered: ORD-1', 'offline_complete_delivery', 'conflict', 'This stop was reassigned', now()) on conflict (user_id, request_id) do nothing$q$) is null, 'runs: a driver records a rejection, sent the way the app does (duplicates ignored)');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad1', $q$insert into public.sync_rejections (request_id, action, rpc_name, kind, reason, queued_at) values ('10000000-0000-4000-8000-000000000002', 'Mark delivered: ORD-1', 'offline_complete_delivery', 'conflict', 'This stop was reassigned', now()) on conflict (user_id, request_id) do nothing$q$) is null, 'runs: a report sent twice is accepted and kept once');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad1', $q$insert into public.sync_rejections (user_id, request_id, action, rpc_name, kind, reason, queued_at) values ('00000000-0000-0000-0000-000000000ac1', gen_random_uuid(), 'x', 'x', 'error', 'x', now())$q$) like '42501 %', 'nobody can record a rejection as someone else');
update public.profiles set status = 'inactive' where id = '00000000-0000-0000-0000-000000000ad2';
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-000000000ad2', $q$insert into public.sync_rejections (request_id, action, rpc_name, kind, reason, queued_at) values (gen_random_uuid(), 'Mark delivered: ORD-4', 'offline_complete_delivery', 'permission', 'Your account can no longer confirm deliveries', now()) on conflict (user_id, request_id) do nothing$q$) is null, 'a just-deactivated account can still record why its changes were refused');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-000000000aa1', $q$select to_jsonb(count(*)) from public.sync_rejections$q$))::int = 2, 'administrators see every rejection');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-000000000ac1', $q$select to_jsonb(count(*)) from public.sync_rejections$q$))::int = 0, 'other staff see none of anyone else''s');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-000000000ad1', $q$select to_jsonb(count(*)) from public.sync_rejections$q$))::int = 1, 'a driver sees only their own');
delete from public.mutation_requests where created_at < now() - interval '1 hour';
insert into public.mutation_requests (user_id, request_id, rpc_name, args_hash, status, created_at, completed_at) values
  ('00000000-0000-0000-0000-000000000ad1', gen_random_uuid(), 'old', 'x', 'done', now() - interval '91 days', now() - interval '91 days'),
  ('00000000-0000-0000-0000-000000000ad1', '90000000-0000-4000-8000-000000000089', 'kept', 'x', 'done', now() - interval '89 days', now() - interval '89 days');
select pg_temp.ok(public.prune_offline_records() = 1 and exists (select 1 from public.mutation_requests where request_id = '90000000-0000-4000-8000-000000000089'), 'duplicate-protection records are kept for 90 days, then pruned');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.prune_offline_records()', 'execute'), 'the app cannot prune records');
rollback;
