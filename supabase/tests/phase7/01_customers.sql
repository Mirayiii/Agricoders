-- Phase 7 customers: permissions, archive instead of delete, no new orders for
-- archived customers, order counts, history and receipt snapshots.
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
-- Runs sql as the database owner (no app user) and returns the error message.
create function pg_temp.err_owner(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
-- Runs a query that returns one jsonb value as the given user.
create function pg_temp.run(uid uuid, sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_user(uid);
  set local role authenticated;
  execute sql into v;
  reset role;
  return v;
end $$;

begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007a1', 'admin7@meah.test', '{"full_name":"Ana Admin"}'),
  ('00000000-0000-0000-0000-0000000007c1', 'office7@meah.test', '{"full_name":"Liza Office"}'),
  ('00000000-0000-0000-0000-0000000007f1', 'purchasing7@meah.test', '{"full_name":"Pia Purchasing"}'),
  ('00000000-0000-0000-0000-0000000007d1', 'rico7@meah.test', '{"full_name":"Rico Bautista"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000007a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000007c1';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id = '00000000-0000-0000-0000-0000000007f1';
update public.profiles set status = 'active', role = 'delivery_staff' where id = '00000000-0000-0000-0000-0000000007d1';

insert into public.products (id, product_name, unit_of_measurement) values
  ('00000000-0000-0000-0000-0000000007b1', 'P7 Tomatoes', 'kg'),
  ('00000000-0000-0000-0000-0000000007b2', 'P7 Cabbage', 'head'),
  ('00000000-0000-0000-0000-0000000007b3', 'P7 Carrots', 'kg'),
  ('00000000-0000-0000-0000-0000000007b4', 'P7 Mangoes', 'kg');
insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by)
select id, 50, 80, now() - interval '1 day', '00000000-0000-0000-0000-0000000007a1' from public.products where product_name like 'P7 %';

create temp table t (name text primary key, value jsonb) on commit drop;
grant all on t to authenticated;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007f1', $q$select public.save_customer(null, '{"customer_code":"P7-X","business_name":"X"}', gen_random_uuid())$q$) like 'Only administrators and administrative staff%', 'purchasing staff cannot add customers');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007d1', $q$select public.save_customer(null, '{"customer_code":"P7-X","business_name":"X"}', gen_random_uuid())$q$) like 'Only administrators and administrative staff%', 'delivery staff cannot add customers');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007f1', $q$insert into public.customers (customer_code, business_name) values ('P7-X', 'X')$q$) is not null, 'purchasing staff cannot add customers directly in the table either');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007d1', $q$select count(*) from public.get_customers()$q$) like 'Only administrators and administrative staff%', 'delivery staff cannot list customers');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007f1', $q$select public.get_customer_profile('00000000-0000-0000-0000-0000000007a1')$q$) like 'Only administrators and administrative staff%', 'purchasing staff cannot open a customer profile');

-- ---------------------------------------------------------------------------
-- Add and edit, with the existing rules
-- ---------------------------------------------------------------------------
insert into t values ('added', pg_temp.run('00000000-0000-0000-0000-0000000007c1',
  $q$select public.save_customer(null, '{"customer_code":" P7-001 ","business_name":"  Casa   Verde ","contact_person":"Mark Reyes","phone":"0917 555 0142","email":"  ","delivery_address":"12 Mabini St., Makati"}', '77777777-7777-4777-8777-777777777701')$q$));
insert into t values ('addedagain', pg_temp.run('00000000-0000-0000-0000-0000000007c1',
  $q$select public.save_customer(null, '{"customer_code":" P7-001 ","business_name":"  Casa   Verde ","contact_person":"Mark Reyes","phone":"0917 555 0142","email":"  ","delivery_address":"12 Mabini St., Makati"}', '77777777-7777-4777-8777-777777777701')$q$));
create temp table c7 on commit drop as select (value->>'customer_id')::uuid as id from t where name = 'added';
grant all on c7 to authenticated;
select pg_temp.ok((select customer_code = 'P7-001' and business_name = 'Casa Verde' and email is null and status = 'active' from public.customers where id = (select id from c7)), 'office staff add a customer; text is trimmed and a blank email is saved as not recorded');
select pg_temp.ok((select (value->>'replayed')::boolean from t where name = 'addedagain') and (select count(*) from public.customers where customer_code = 'P7-001') = 1, 'a retried Add customer creates one customer');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007c1', $q$select public.save_customer(null, '{"customer_code":"  ","business_name":"No code"}', gen_random_uuid())$q$) = 'Enter a customer code', 'the code is required');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007c1', $q$select public.save_customer(null, '{"customer_code":"P7-002","business_name":""}', gen_random_uuid())$q$) = 'Enter the business name', 'the business name is required');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007c1', $q$select public.save_customer(null, '{"customer_code":"P7-001","business_name":"Other"}', gen_random_uuid())$q$) = 'Customer code P7-001 is already used by Casa Verde', 'a code already in use is refused, naming the customer');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007a1', $q$update public.customers set business_name = '   ' where customer_code = 'P7-001'$q$) = 'Enter the business name', 'the same rules apply to a direct table write from an older app');

-- A second customer, used for the order count checks.
insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-0000000007c2', 'P7-002', 'Kusina ni Maria');

-- ---------------------------------------------------------------------------
-- Orders, deliveries and a receipt for Casa Verde
-- ---------------------------------------------------------------------------
-- o1: completed with 3 lines, a delivery and a receipt. o2: confirmed with
-- 2 lines. o3: cancelled. Kusina has one order.
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000007e1', (select id from c7), 'phone', '00000000-0000-0000-0000-0000000007c1', 'for_delivery', current_date),
  ('00000000-0000-0000-0000-0000000007e2', (select id from c7), 'phone', '00000000-0000-0000-0000-0000000007c1', 'confirmed', current_date + 2),
  ('00000000-0000-0000-0000-0000000007e3', (select id from c7), 'phone', '00000000-0000-0000-0000-0000000007c1', 'cancelled', current_date - 3),
  ('00000000-0000-0000-0000-0000000007e4', '00000000-0000-0000-0000-0000000007c2', 'phone', '00000000-0000-0000-0000-0000000007c1', 'confirmed', current_date + 1);
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price) values
  ('00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007b1', 2, 'kg', 80, 80, 50),
  ('00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007b2', 3, 'head', 60, 60, 40),
  ('00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007b3', 1, 'kg', 70, 70, 50),
  ('00000000-0000-0000-0000-0000000007e2', '00000000-0000-0000-0000-0000000007b1', 1, 'kg', 80, 80, 50),
  ('00000000-0000-0000-0000-0000000007e2', '00000000-0000-0000-0000-0000000007b2', 1, 'head', 60, 60, 40),
  ('00000000-0000-0000-0000-0000000007e3', '00000000-0000-0000-0000-0000000007b4', 9, 'kg', 90, 90, 60),
  ('00000000-0000-0000-0000-0000000007e4', '00000000-0000-0000-0000-0000000007b1', 1, 'kg', 80, 80, 50);
insert into public.deliveries (id, order_id, assigned_driver_id, scheduled_date) values
  ('00000000-0000-0000-0000-0000000007f9', '00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007d1', current_date);
insert into t values ('done', pg_temp.run('00000000-0000-0000-0000-0000000007d1',
  $q$select public.complete_delivery('00000000-0000-0000-0000-0000000007f9', 'Mark', gen_random_uuid(), tests.pv_delivery('00000000-0000-0000-0000-0000000007f9'))$q$));
-- A preferred product for Casa Verde.
insert into public.customer_product_preferences (customer_id, product_id, ranking) values ((select id from c7), '00000000-0000-0000-0000-0000000007b4', 1);

-- ---------------------------------------------------------------------------
-- Order counts
-- ---------------------------------------------------------------------------
insert into t values ('list', pg_temp.run('00000000-0000-0000-0000-0000000007c1',
  $q$select jsonb_agg(to_jsonb(c)) from public.get_customers() c where customer_code like 'P7-%'$q$));
select pg_temp.ok((select (x->>'order_count')::int from t, jsonb_array_elements(value) x where name = 'list' and x->>'customer_code' = 'P7-001') = 3, 'Casa Verde has 3 orders: lines, a delivery and a receipt do not count twice');
select pg_temp.ok((select (x->>'order_count')::int from t, jsonb_array_elements(value) x where name = 'list' and x->>'customer_code' = 'P7-002') = 1, 'Kusina has 1 order');
select pg_temp.ok((select (x->>'last_order_date')::date from t, jsonb_array_elements(value) x where name = 'list' and x->>'customer_code' = 'P7-001') = current_date + 2, 'the list shows the latest delivery date');
insert into t values ('history', pg_temp.run('00000000-0000-0000-0000-0000000007c1',
  format($q$select jsonb_agg(to_jsonb(h)) from public.get_customer_order_history(%L, 20, 0) h$q$, (select id from c7))));
select pg_temp.ok((select jsonb_array_length(value) = 3 and (value->0->>'total_rows')::int = 3 from t where name = 'history'), 'the count matches the order history');
insert into t values ('profile', pg_temp.run('00000000-0000-0000-0000-0000000007c1', format($q$select public.get_customer_profile(%L)$q$, (select id from c7))));
select pg_temp.ok((select (value->>'order_count')::int = 3 from t where name = 'profile'), 'the detail screen shows the same count');
select pg_temp.ok((select array(select x->>'product_name' from jsonb_array_elements(value->'usual_products') x) = array['P7 Mangoes', 'P7 Cabbage', 'P7 Tomatoes', 'P7 Carrots'] from t where name = 'profile'),
  'usual products: the preferred one first, then the most ordered (cancelled orders not counted)');

-- ---------------------------------------------------------------------------
-- Editing a customer leaves issued receipts unchanged
-- ---------------------------------------------------------------------------
insert into t values ('receipt_before', (select to_jsonb(r) from public.delivery_receipts r where order_id = '00000000-0000-0000-0000-0000000007e1'));
insert into t values ('edited', pg_temp.run('00000000-0000-0000-0000-0000000007a1',
  format($q$select public.save_customer(%L, '{"customer_code":"P7-001","business_name":"Casa Verde Holdings","contact_person":"Mark Reyes","phone":"0917 555 0142","delivery_address":"99 New Road, Pasig"}', gen_random_uuid())$q$, (select id from c7))));
select pg_temp.ok((select business_name = 'Casa Verde Holdings' and delivery_address = '99 New Road, Pasig' from public.customers where id = (select id from c7)), 'administrators edit customer details');
select pg_temp.ok((select value->'details'->'fields' = '["business_name", "delivery_address"]'::jsonb from (select to_jsonb(a) as value from public.customer_activity a where customer_id = (select id from c7) and action = 'updated') x), 'the edit is logged with the fields that changed');
select pg_temp.ok((select to_jsonb(r) from public.delivery_receipts r where order_id = '00000000-0000-0000-0000-0000000007e1') = (select value from t where name = 'receipt_before'), 'the issued receipt is unchanged after the edit');
select pg_temp.ok((select content->>'customer_name' = 'Casa Verde' and content->>'delivery_address' = '12 Mabini St., Makati' from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000007e1'), 'the receipt still shows the name and address it was issued with');
-- Brand name and TIN#.
insert into t values ('branded', pg_temp.run('00000000-0000-0000-0000-0000000007c1',
  format($q$select public.save_customer(%L, '{"customer_code":"P7-001","business_name":"Casa Verde Holdings","brand_name":"  Casa   Verde Restaurant ","tin":" 001-234-567-000 ","contact_person":"Mark Reyes","phone":"0917 555 0142","delivery_address":"99 New Road, Pasig"}', gen_random_uuid())$q$, (select id from c7))));
select pg_temp.ok((select brand_name = 'Casa Verde Restaurant' and tin = '001-234-567-000' and business_name = 'Casa Verde Holdings' from public.customers where id = (select id from c7)),
  'brand name and TIN# are saved; the TIN keeps its leading zeros and dashes, and the business name is kept');
select pg_temp.ok((select value->>'brand_name' = 'Casa Verde Restaurant' from t where name = 'branded'), 'saving returns the brand name for display');
select pg_temp.ok((select x->>'brand_name' = 'Casa Verde Restaurant' and x->>'tin' = '001-234-567-000'
  from jsonb_array_elements(pg_temp.run('00000000-0000-0000-0000-0000000007c1', $q$select jsonb_agg(to_jsonb(c)) from public.get_customers() c where customer_code = 'P7-001'$q$)) x),
  'the customer list includes brand name and TIN#');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007c1', $q$select public.save_customer(null, '{"customer_code":"P7-001","business_name":"Other"}', gen_random_uuid())$q$) = 'Customer code P7-001 is already used by Casa Verde Restaurant',
  'a duplicate code names the customer by their brand name');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007c1', format($q$select public.save_customer(%L, '{"customer_code":"P7-001","business_name":"Casa Verde Holdings","contact_person":"Mark Reyes","phone":"0917 555 0142","delivery_address":"99 New Road, Pasig"}', gen_random_uuid())$q$, (select id from c7))) is null
  and (select brand_name = 'Casa Verde Restaurant' and tin = '001-234-567-000' from public.customers where id = (select id from c7)),
  'an older app that doesn''t send brand name or TIN# leaves them as they are');
select pg_temp.ok((select to_jsonb(r) from public.delivery_receipts r where order_id = '00000000-0000-0000-0000-0000000007e1') = (select value from t where name = 'receipt_before'), 'adding a brand name leaves the issued receipt unchanged');
update public.customers set brand_name = '   ', tin = '' where id = (select id from c7);
select pg_temp.ok((select brand_name is null and tin is null from public.customers where id = (select id from c7)), 'blank brand name and TIN# are saved as not recorded');
insert into t values ('reprint', pg_temp.run('00000000-0000-0000-0000-0000000007c1', $q$select public.issue_delivery_receipt('00000000-0000-0000-0000-0000000007e1', gen_random_uuid())$q$));
select pg_temp.ok((select count(*) = 1 from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000007e1')
  and (select (value->>'dr_number')::bigint from t where name = 'reprint') = (select (value->>'dr_number')::bigint from t where name = 'receipt_before'),
  'a reprint after the edit keeps the same DR number and contents');

-- Requirement CU-01: business type and preferred delivery window, both optional.
insert into t values ('typed', pg_temp.run('00000000-0000-0000-0000-0000000007c1',
  $q$select public.save_customer(null, '{"customer_code":"P7-CU01","business_name":"Kusina Uno","business_type":"  Restaurant   chain ","preferred_delivery_window":" 6:00 to 9:00 AM ","notes":"Back gate"}', gen_random_uuid())$q$));
select pg_temp.ok((select business_type = 'Restaurant chain' and preferred_delivery_window = '6:00 to 9:00 AM' from public.customers where customer_code = 'P7-CU01'), 'office staff save a business type and delivery window, trimmed');
select pg_temp.run('00000000-0000-0000-0000-0000000007c1', format($q$select public.save_customer(%L, '{"customer_code":"P7-CU01","business_name":"Kusina Uno"}', gen_random_uuid())$q$, (select (value->>'customer_id') from t where name = 'typed')));
select pg_temp.ok((select business_type = 'Restaurant chain' and preferred_delivery_window = '6:00 to 9:00 AM' from public.customers where customer_code = 'P7-CU01'), 'an older app that doesn''t send the new fields leaves them as they are');
-- Prototype (5 Nov): the form no longer has Notes; a save without it keeps the saved note.
select pg_temp.ok((select notes = 'Back gate' from public.customers where customer_code = 'P7-CU01'), 'a save without notes keeps the note saved earlier');
select pg_temp.ok((select business_type is null and preferred_delivery_window is null from public.customers where id = (select id from c7)), 'existing customers simply have none recorded');
select pg_temp.ok((select value->'P7-CU01'->>'business_type' = 'Restaurant chain' from (select pg_temp.run('00000000-0000-0000-0000-0000000007c1', $q$select jsonb_object_agg(customer_code, to_jsonb(c)) from public.get_customers() c$q$) as value) x), 'the customer list returns the new fields');

-- ---------------------------------------------------------------------------
-- Archive and restore
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007f1', format($q$select public.set_customer_archived(%L, true, gen_random_uuid())$q$, (select id from c7))) = 'Only administrators and administrative staff can archive or restore customers', 'purchasing staff cannot archive customers');
-- Prototype (5 Nov): administrative staff archive and restore too, through the function or the table.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007c1', format($q$select public.set_customer_archived(%L, true, gen_random_uuid())$q$, (select id from c7))) is null, 'administrative staff archive customers');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007c1', format($q$select public.set_customer_archived(%L, false, gen_random_uuid())$q$, (select id from c7))) is null, 'and restore them');
select pg_temp.err('00000000-0000-0000-0000-0000000007f1', format($q$update public.customers set status = 'archived', archived_at = now() where id = %L$q$, (select id from c7)));
select pg_temp.ok((select status = 'active' from public.customers where id = (select id from c7)), 'purchasing staff cannot archive by changing the customer row directly');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007a1', format($q$delete from public.customers where id = %L$q$, (select id from c7))) is not null, 'customers cannot be deleted from the app');
select pg_temp.ok(pg_temp.err_owner($q$delete from public.customers where customer_code = 'P7-002'$q$) = 'Customers are archived, not deleted, so their order history is kept.', 'not even by a direct database delete, which explains that customers are archived instead');

insert into t values ('archived', pg_temp.run('00000000-0000-0000-0000-0000000007a1', format($q$select public.set_customer_archived(%L, true, '77777777-7777-4777-8777-777777777702')$q$, (select id from c7))));
insert into t values ('archivedagain', pg_temp.run('00000000-0000-0000-0000-0000000007a1', format($q$select public.set_customer_archived(%L, true, '77777777-7777-4777-8777-777777777702')$q$, (select id from c7))));
insert into t values ('archivedtwice', pg_temp.run('00000000-0000-0000-0000-0000000007a1', format($q$select public.set_customer_archived(%L, true, gen_random_uuid())$q$, (select id from c7))));
select pg_temp.ok((select status = 'archived' and archived_at is not null from public.customers where id = (select id from c7)), 'the administrator archives a customer');
select pg_temp.ok((select (value->>'replayed')::boolean from t where name = 'archivedagain') and (select count(*) from public.customer_activity where customer_id = (select id from c7) and action = 'archived') = 2,
  'a retried or repeated archive is done and logged once (the second entry is the administrative staff archive above)');

-- History stays.
select pg_temp.ok((select count(*) from public.orders where customer_id = (select id from c7)) = 3, 'archiving keeps every order');
insert into t values ('history_after', pg_temp.run('00000000-0000-0000-0000-0000000007c1',
  format($q$select jsonb_agg(to_jsonb(h)) from public.get_customer_order_history(%L, 20, 0) h$q$, (select id from c7))));
select pg_temp.ok((select jsonb_array_length(value) = 3 from t where name = 'history_after'), 'the archived customer''s order history is still listed');
insert into t values ('list_after', pg_temp.run('00000000-0000-0000-0000-0000000007c1',
  $q$select jsonb_agg(to_jsonb(c)) from public.get_customers() c where customer_code = 'P7-001'$q$));
select pg_temp.ok((select value->0->>'status' = 'archived' and (value->0->>'order_count')::int = 3 from t where name = 'list_after'), 'the archived customer is listed under Archived with the same order count');
select pg_temp.ok((select pg_temp.run('00000000-0000-0000-0000-0000000007c1', $q$select to_jsonb(count(*)) from public.orders where id = '00000000-0000-0000-0000-0000000007e2'$q$))::int = 1, 'office staff can still read the archived customer''s orders');
select pg_temp.ok((select pg_temp.run('00000000-0000-0000-0000-0000000007d1', $q$select to_jsonb(count(*)) from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000007e1'$q$))::int = 1, 'the driver can still open the receipt');
select pg_temp.ok((select status = 'completed' from public.orders where id = '00000000-0000-0000-0000-0000000007e1'), 'the delivered order stays completed');
-- Existing orders keep moving.
update public.orders set status = 'for_preparation' where id = '00000000-0000-0000-0000-0000000007e2';
select pg_temp.ok((select status = 'for_preparation' from public.orders where id = '00000000-0000-0000-0000-0000000007e2'), 'an open order of an archived customer can still be packed and delivered');

-- No new orders.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007c1', format($q$select public.create_order(jsonb_build_object('customer_id', %L, 'requested_delivery_date', current_date + 1, 'order_source_id', (select id from public.order_sources where code = 'viber')), '[{"product_id":"00000000-0000-0000-0000-0000000007b1","quantity":1,"unit_of_measurement":"kg"}]', gen_random_uuid())$q$, (select id from c7)))
  = 'This customer is archived. Restore them before creating an order.', 'an archived customer cannot be given a new order');
select pg_temp.ok(pg_temp.err_owner(format($q$insert into public.orders (customer_id, order_source, encoded_by, requested_delivery_date) values (%L, 'phone', '00000000-0000-0000-0000-0000000007c1', current_date + 1)$q$, (select id from c7)))
  = 'This customer is archived. Restore them before creating an order.', 'not even by a direct insert');
select pg_temp.ok(pg_temp.err_owner(format($q$update public.orders set customer_id = %L where id = '00000000-0000-0000-0000-0000000007e4'$q$, (select id from c7)))
  = 'This customer is archived. Restore them before creating an order.', 'and an order cannot be moved to an archived customer');
select pg_temp.ok((select pg_temp.run('00000000-0000-0000-0000-0000000007c1', $q$select to_jsonb(count(*)) from public.customers where status = 'active' and customer_code = 'P7-001'$q$))::int = 0, 'the New order customer list (active customers) leaves them out');

-- Restore.
insert into t values ('restored', pg_temp.run('00000000-0000-0000-0000-0000000007a1', format($q$select public.set_customer_archived(%L, false, gen_random_uuid())$q$, (select id from c7))));
select pg_temp.ok((select status = 'active' and archived_at is null from public.customers where id = (select id from c7)), 'administrators restore a customer');
select pg_temp.ok((select count(*) from public.customer_activity where customer_id = (select id from c7) and action = 'restored') = 2, 'the restore is logged (after the administrative staff restore above)');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000007c1', format($q$select public.create_order(jsonb_build_object('customer_id', %L, 'requested_delivery_date', current_date + 1, 'order_source_id', (select id from public.order_sources where code = 'viber')), '[{"product_id":"00000000-0000-0000-0000-0000000007b1","quantity":1,"unit_of_measurement":"kg"}]', gen_random_uuid())$q$, (select id from c7))) is null,
  'a restored customer can be given a new order again');
select pg_temp.ok((select count(*) from public.orders where customer_id = (select id from c7)) = 4, 'and it is their fourth order');
select pg_temp.ok((select content->>'customer_name' = 'Casa Verde' from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000007e1'), 'the old receipt is still unchanged after archive and restore');
rollback;
