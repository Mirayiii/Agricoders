-- Phase 4 New order: create_order, retry protection, sources and delivery times, on a local database built by run_local.sh.
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
insert into public.products (id, product_name, unit_of_measurement) values ('00000000-0000-0000-0000-00000000b001', 'Tomatoes', 'kg'), ('00000000-0000-0000-0000-00000000b002', 'Carrots', 'kg');
insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by) values
  ('00000000-0000-0000-0000-00000000b001', 60, 85, now() - interval '1 day', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000b002', 70, 95, now() - interval '1 day', '00000000-0000-0000-0000-0000000000a1');
-- Carrots: 2 kg on hand, so an order for 5 kg asks for more than there is.
insert into public.product_skus (id, product_id, selling_sku, unit_of_measurement) values ('00000000-0000-0000-0000-0000000005c2', '00000000-0000-0000-0000-00000000b002', 'CAR-KG', 'kg');
insert into public.inventory (sku_id, current_quantity) values ('00000000-0000-0000-0000-0000000005c2', 2);

create temp table t (name text primary key, value jsonb) on commit drop;
grant all on t to authenticated;
-- Request ids used below.
create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids values
  ('viber', (select id from public.order_sources where code = 'viber')),
  ('req1', '22222222-2222-4222-8222-222222222222');

create function pg_temp.order_json(extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c001', 'requested_delivery_date', current_date + 1,
    'order_source_id', (select id from ids where name = 'viber'), 'notes', 'Back entrance') || extra;
$$;
create function pg_temp.items() returns jsonb language sql as $$
  select '[{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":1.5,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b002","quantity":5,"unit_of_measurement":"kg"}]'::jsonb;
$$;

-- Permissions.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', $q$select public.create_order(pg_temp.order_json(), pg_temp.items(), gen_random_uuid())$q$) like 'You do not have permission%', 'purchasing cannot create orders');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', $q$select public.create_order(pg_temp.order_json(), pg_temp.items(), gen_random_uuid())$q$) like 'You do not have permission%', 'delivery cannot create orders');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json(), pg_temp.items(), null)$q$) = 'A request id is required', 'a request id is required');

-- Validation; a refused order leaves nothing behind.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json() - 'order_source_id', pg_temp.items(), gen_random_uuid())$q$) = 'Choose where the order came from', 'the source is required');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json('{"delivery_time_end":"09:00"}'), pg_temp.items(), gen_random_uuid())$q$) = 'Add a start time before an end time', 'an end time needs a start time');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json('{"delivery_time_start":"09:00","delivery_time_end":"08:30"}'), pg_temp.items(), gen_random_uuid())$q$) = 'The end time must be after the start time', 'the end time must be after the start');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json('{"sales_invoice_number":"13451; drop"}'), pg_temp.items(), gen_random_uuid())$q$) like 'Use up to 40%', 'the SI# format is checked');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json('{"discount":{"type":"fixed","value":700,"reason":"Promo"}}'), pg_temp.items(), gen_random_uuid())$q$) like 'The discount cannot be more than the subtotal of 602.50', 'a peso discount above the server subtotal is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json('{"discount":{"type":"percent","value":10,"reason":" "}}'), pg_temp.items(), gen_random_uuid())$q$) = 'A reason is required for a discount', 'a discount needs a reason');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json('{"discount":{"type":"percent","value":0,"reason":"None"}}'), pg_temp.items(), gen_random_uuid())$q$) = 'Enter a discount greater than zero', 'a zero discount is refused (leave it off instead)');
select pg_temp.ok((select count(*) from public.orders) = 0 and (select count(*) from public.mutation_requests where rpc_name = 'create_order') = 0, 'refused orders leave no order and no request record');

-- The full step 3: time, source, SI#, discount, Needs checking off.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
insert into t values ('first', public.create_order(pg_temp.order_json('{"delivery_time_start":"07:00","delivery_time_end":"09:30","sales_invoice_number":"SI-00123","discount":{"type":"percent","value":10,"reason":"Opening promo"}}'), pg_temp.items(), (select id from ids where name = 'req1')));
reset role;
select pg_temp.ok((select (value->>'total')::numeric = 542.25 and (value->>'subtotal')::numeric = 602.50 and value ? 'order_number' and value->>'status' = 'confirmed' from t where name = 'first'), 'the result has the server total (602.50 less 10% = 542.25), number and status');
select pg_temp.ok((select order_source = 'viber' and order_source_id = (select id from ids where name = 'viber') and delivery_time_start = '07:00' and delivery_time_end = '09:30' and sales_invoice_number = 'SI-00123' and discount_type = 'percent' and money_rounding = 'line' from public.orders), 'the order keeps the source, time, SI#, discount and line rounding');
select pg_temp.ok((select status = 'confirmed' and not requires_attention from public.orders), 'prototype: an order without Needs checking is confirmed as it is saved');
select pg_temp.ok((select array_agg(action order by action) from public.order_activity) = array['created', 'discount_applied', 'sales_invoice_set', 'status_changed'], 'creation, SI#, discount and the confirmation are each logged');
select pg_temp.ok(not exists (select 1 from public.notifications where type = 'order_requires_verification'), 'a confirmed new order leaves no "requires verification" alert');

-- Provisional stock rules: over-stock is allowed and nothing is deducted.
select pg_temp.ok((select quantity from public.order_items where product_id = '00000000-0000-0000-0000-00000000b002') = 5, 'provisional: an order may ask for more than the stock on hand');
select pg_temp.ok((select current_quantity from public.inventory) = 2 and (select count(*) from public.inventory_transactions) = 0, 'provisional: creating an order does not reserve or deduct stock');

-- Retry protection.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
insert into t values ('retry', public.create_order(pg_temp.order_json('{"delivery_time_start":"07:00","delivery_time_end":"09:30","sales_invoice_number":"SI-00123","discount":{"type":"percent","value":10,"reason":"Opening promo"}}'), pg_temp.items(), (select id from ids where name = 'req1')));
reset role;
select pg_temp.ok((select count(*) from public.orders) = 1, 'a repeated call creates one order');
select pg_temp.ok((select (r.value->>'order_id') = (f.value->>'order_id') and (r.value->>'replayed')::boolean from t r, t f where r.name = 'retry' and f.name = 'first'), 'the retry returns the first order');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json(), pg_temp.items(), '22222222-2222-4222-8222-222222222222')$q$) = 'request_id_reused', 'the same request id with different details is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.create_order(pg_temp.order_json(), pg_temp.items(), '22222222-2222-4222-8222-222222222222')$q$) is null, 'request ids are per user');
select pg_temp.ok((select count(*) from public.orders) = 2, 'another user''s order with the same request id is a separate order');

-- Order again keeps working through the same call.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format($q$select public.create_order(pg_temp.order_json(), pg_temp.items(), gen_random_uuid(), %L)$q$, (select (value->>'order_id')::uuid from t where name = 'first'))) is null, 'order again creates a new order');
select pg_temp.ok((select count(*) from public.order_activity where action = 'created_by_duplication') = 1, 'order again is logged');

-- Manage order sources (administrators).
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.add_order_source('WhatsApp')$q$) = 'Only an administrator can change order sources', 'office staff cannot change order sources');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.add_order_source('  WhatsApp  ')$q$) is null, 'an administrator can add a source');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.add_order_source('whatsapp')$q$) = 'WhatsApp is already on the list', 'a duplicate source is refused');
insert into ids values ('whatsapp', (select id from public.order_sources where label = 'WhatsApp'));
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json(jsonb_build_object('order_source_id', (select id from ids where name = 'whatsapp'))), pg_temp.items(), gen_random_uuid())$q$) is null, 'an order can use a new source');
select pg_temp.ok((select order_source = 'other' from public.orders where order_source_id = (select id from ids where name = 'whatsapp')), 'a new source is stored as Other for the old app');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', format('select public.remove_order_source(%L)', (select id from ids where name = 'whatsapp'))) is null, 'an administrator can remove a source');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json(jsonb_build_object('order_source_id', (select id from ids where name = 'whatsapp'))), pg_temp.items(), gen_random_uuid())$q$) like 'That order source is no longer offered%', 'a removed source cannot be used for new orders');
select pg_temp.ok((select count(*) from public.orders where order_source_id = (select id from ids where name = 'whatsapp')) = 1, 'old orders keep a removed source');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.add_order_source('WhatsApp')$q$) is null, 'a removed source can be added again');
select pg_temp.ok((select is_active from public.order_sources where label = 'WhatsApp'), 'adding a removed source again brings it back');
update public.order_sources set is_active = false where label <> 'Viber';
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', format('select public.remove_order_source(%L)', (select id from ids where name = 'viber'))) = 'Keep at least one order source', 'the last source cannot be removed');
update public.order_sources set is_active = true;

-- Manage delivery times (administrators).
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.add_delivery_time_slot('07:00', '09:00')$q$) = 'Only an administrator can change delivery times', 'office staff cannot change delivery times');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.add_delivery_time_slot('07:00', '09:00')$q$) is null, 'an administrator can add a delivery time');
select pg_temp.ok((select label from public.delivery_time_slots) = '7:00 AM – 9:00 AM', 'the delivery time is labelled from its times');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.add_delivery_time_slot('07:00', '09:00')$q$) = '7:00 AM – 9:00 AM is already on the list', 'a duplicate delivery time is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.add_delivery_time_slot('10:00', '09:00')$q$) = 'The end time must be after the start time', 'a delivery time must end after it starts');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.add_delivery_time_slot('13:30')$q$) is null, 'a delivery time may have no end');
select pg_temp.ok(exists (select 1 from public.delivery_time_slots where label = '1:30 PM' and ends_at is null), 'an open-ended delivery time is labelled by its start');
insert into ids values ('slot', (select id from public.delivery_time_slots where label = '7:00 AM – 9:00 AM'));
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json(jsonb_build_object('delivery_time_slot_id', (select id from ids where name = 'slot'))), pg_temp.items(), gen_random_uuid())$q$) is null, 'an order can use a saved delivery time');
select pg_temp.ok((select delivery_time_start = '07:00' and delivery_time_end = '09:00' from public.orders where delivery_time_slot_id = (select id from ids where name = 'slot')), 'the saved time fills in the start and end');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', format('select public.remove_delivery_time_slot(%L)', (select id from ids where name = 'slot'))) is null, 'an administrator can remove a delivery time');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json(jsonb_build_object('delivery_time_slot_id', (select id from ids where name = 'slot'))), pg_temp.items(), gen_random_uuid())$q$) like 'That delivery time is no longer offered%', 'a removed delivery time cannot be used');
select pg_temp.ok((select delivery_time_start = '07:00' from public.orders where delivery_time_slot_id = (select id from ids where name = 'slot')), 'old orders keep their delivery time');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', 'insert into public.delivery_time_slots (label) values (''x'')') like 'permission denied%', 'the lists cannot be written directly');

-- Price overrides: administrators only, with a reason (checked on the server).
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json(), '[{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":1,"unit_of_measurement":"kg","special_price":1,"special_price_reason":"Friend"}]'::jsonb, gen_random_uuid())$q$) = 'Special pricing requires an administrator and reason', 'office staff cannot override a price, even by calling the server directly');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.create_order(pg_temp.order_json(), '[{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":1,"unit_of_measurement":"kg","special_price":80}]'::jsonb, gen_random_uuid())$q$) = 'Special pricing requires an administrator and reason', 'a price override needs a reason');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', $q$select public.create_order(pg_temp.order_json('{"notes":"special price"}'), '[{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":1,"unit_of_measurement":"kg","special_price":80,"special_price_reason":"Agreed with customer"}]'::jsonb, gen_random_uuid())$q$) is null, 'an administrator can override a price with a reason');
select pg_temp.ok((select unit_price = 80 and original_unit_price = 85 and special_price_reason = 'Agreed with customer' and special_price_authorized_by = '00000000-0000-0000-0000-0000000000a1' from public.order_items oi join public.orders o on o.id = oi.order_id where o.notes = 'special price'), 'the override keeps the list price, the reason and who approved it');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json('{"notes":"client price ignored"}'), '[{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":1,"unit_of_measurement":"kg","unit_price":1}]'::jsonb, gen_random_uuid())$q$) is null, 'a price sent by the app without an override is ignored');
select pg_temp.ok((select unit_price = 85 from public.order_items oi join public.orders o on o.id = oi.order_id where o.notes = 'client price ignored'), 'the server uses the list price');

-- Needs checking saves the flag and its reason; the order starts For verification.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json('{"notes":"needs checking","requires_attention":true,"attention_reason":"Confirm onion quantity"}'), pg_temp.items(), gen_random_uuid())$q$) is null, 'an order can be saved with Needs checking');
select pg_temp.ok((select requires_attention and attention_reason = 'Confirm onion quantity' and status = 'for_verification' from public.orders where notes = 'needs checking'), 'Needs checking saves the flag and reason, and the order stays For verification');
select pg_temp.ok((select details->>'reason' = 'Confirm onion quantity' from public.order_activity a join public.orders o on o.id = a.order_id where o.notes = 'needs checking' and a.action = 'requires_attention'), 'the flag and its reason are logged');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order(pg_temp.order_json('{"requires_attention":true,"attention_reason":"  "}'), pg_temp.items(), gen_random_uuid())$q$) is not null, 'Needs checking without a reason is refused');

-- The old app's call still works.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', $q$select public.create_order_with_items(pg_temp.order_json() || '{"order_source":"phone"}', pg_temp.items())$q$) is null, 'the old create_order_with_items still works');
rollback;
