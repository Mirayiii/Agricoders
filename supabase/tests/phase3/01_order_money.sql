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

insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000c001', 'C-001', 'Casa Verde'), ('00000000-0000-0000-0000-00000000c002', 'C-002', 'Bistro Alon');
insert into public.products (id, product_name) values ('00000000-0000-0000-0000-00000000b001', 'Tomatoes'), ('00000000-0000-0000-0000-00000000b002', 'Red onions'), ('00000000-0000-0000-0000-00000000b003', 'Calamansi');
insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by) values
  ('00000000-0000-0000-0000-00000000b001', 60, 85, now() - interval '1 day', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000b002', 100, 140, now() - interval '1 day', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000b003', 50, 80, now() - interval '1 day', '00000000-0000-0000-0000-0000000000a1');

-- The office creates an order with a fractional line: 0.333 kg x 140 = 46.62.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids values ('o1', public.create_order_with_items(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c001', 'order_source', 'viber', 'requested_delivery_date', current_date),
  '[{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":10,"unit_of_measurement":"kg"},
    {"product_id":"00000000-0000-0000-0000-00000000b002","quantity":0.333,"unit_of_measurement":"kg"}]'::jsonb));
reset role;

select pg_temp.ok((select array_agg(line_total order by line_total) from order_items where order_id = (select id from ids where name = 'o1')) = array[46.62, 850.00]::numeric[], 'each line is rounded once to two decimals');
select pg_temp.ok((select public.order_subtotal(o) = 896.62 and public.order_total(o) = 896.62 from orders o where id = (select id from ids where name = 'o1')), 'subtotal and total with no discount');

-- D-O1: only administrators and administrative staff.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', format('select public.apply_order_discount(%L, ''fixed'', 50, ''Promo'', gen_random_uuid())', (select id from ids where name = 'o1'))) like 'You do not have permission%', 'purchasing staff cannot apply a discount');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', format('select public.apply_order_discount(%L, ''fixed'', 50, ''Promo'', gen_random_uuid())', (select id from ids where name = 'o1'))) like 'You do not have permission%', 'delivery staff cannot apply a discount');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000f1', format('select public.set_sales_invoice_number(%L, ''13451'', null, gen_random_uuid())', (select id from ids where name = 'o1'))) like 'You do not have permission%', 'purchasing staff cannot set SI#');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000d1', format('select public.remove_order_discount(%L, ''Customer paid in full'', gen_random_uuid())', (select id from ids where name = 'o1'))) like 'You do not have permission%', 'delivery staff cannot remove a discount');
select pg_temp.ok(pg_temp.err(null, format('select public.apply_order_discount(%L, ''fixed'', 50, ''Promo'', gen_random_uuid())', (select id from ids where name = 'o1'))) is not null, 'a caller with no account cannot apply a discount');

-- D-O2 validation.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.apply_order_discount(%L, ''fixed'', 50, ''  '', gen_random_uuid())', (select id from ids where name = 'o1'))) = 'A reason is required for a discount', 'a discount without a reason is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.apply_order_discount(%L, ''percent'', 100.5, ''Promo'', gen_random_uuid())', (select id from ids where name = 'o1'))) like 'A percentage discount cannot be more than 100%%', 'more than 100% is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.apply_order_discount(%L, ''percent'', 0, ''Promo'', gen_random_uuid())', (select id from ids where name = 'o1'))) = 'Enter a discount greater than zero', 'a zero discount is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.apply_order_discount(%L, ''fixed'', 896.63, ''Promo'', gen_random_uuid())', (select id from ids where name = 'o1'))) like 'The discount cannot be more than the subtotal of 896.62', 'a peso discount above the subtotal is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.apply_order_discount(%L, ''fixed'', 10.005, ''Promo'', gen_random_uuid())', (select id from ids where name = 'o1'))) = 'Use at most two decimal places', 'more than two decimals is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.apply_order_discount(%L, ''amount'', 10, ''Promo'', gen_random_uuid())', (select id from ids where name = 'o1'))) = 'Choose a fixed amount or a percentage', 'an unknown discount type is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.apply_order_discount(%L, ''fixed'', 10, ''Promo'', null)', (select id from ids where name = 'o1'))) = 'A request id is required', 'a request id is required');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.apply_order_discount(%L, ''fixed'', 896.62, ''Full refund'', gen_random_uuid())', (select id from ids where name = 'o1'))) is null, 'a peso discount equal to the subtotal is allowed');

-- The API cannot write a discount around the RPC.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', format('update public.orders set discount_type = null, discount_value = null, discount_reason = null, discount_by = null, discount_at = null where id = %L', (select id from ids where name = 'o1'))) like 'permission denied%', 'even an administrator cannot update orders directly');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('insert into public.order_activity (order_id, user_id, action) values (%L, auth.uid(), ''discount_applied'')', (select id from ids where name = 'o1'))) like 'permission denied%', 'the activity log cannot be written directly');

-- Percentage discount, applied by the office, with retry protection.
create temp table result (name text primary key, value jsonb) on commit drop;
grant all on result to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
insert into result values ('first', public.apply_order_discount((select id from ids where name = 'o1'), 'percent', 10, 'Late delivery', '11111111-1111-4111-8111-111111111111'));
insert into result values ('retry', public.apply_order_discount((select id from ids where name = 'o1'), 'percent', 10, 'Late delivery', '11111111-1111-4111-8111-111111111111'));
reset role;
-- 896.62 x 10% = 89.662, rounded to 89.66; total 806.96.
select pg_temp.ok((select value->>'discount_amount' = '89.66' and value->>'total' = '806.96' and value->>'subtotal' = '896.62' from result where name = 'first'), 'percent discount is rounded to two decimals on the server');
select pg_temp.ok((select (value->>'replayed')::boolean and value->>'total' = '806.96' from result where name = 'retry'), 'retrying the same request returns the first result');
select pg_temp.ok((select count(*) from order_activity where order_id = (select id from ids where name = 'o1') and action = 'discount_applied') = 2, 'the retry did not log a second change (one for the full discount, one for 10%)');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.apply_order_discount(%L, ''percent'', 20, ''Late delivery'', ''11111111-1111-4111-8111-111111111111'')', (select id from ids where name = 'o1'))) = 'request_id_reused', 'reusing a request id for different details is refused');

-- Every total agrees: order, order report, customer history, customer report.
-- (As an administrator: reports are administrator-only since Phase 8.)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.ok((select public.order_total(o) from orders o where id = (select id from ids where name = 'o1')) = 806.96, 'order total includes the discount');
select pg_temp.ok((select total from public.get_order_report() where order_id = (select id from ids where name = 'o1')) = 806.96, 'order report shows the same total');
select pg_temp.ok((select total from public.get_customer_order_history('00000000-0000-0000-0000-00000000c001') where order_id = (select id from ids where name = 'o1')) = 806.96, 'customer history shows the same total');
select pg_temp.ok((select total_order_amount from public.get_customer_report(p_customer_id => '00000000-0000-0000-0000-00000000c001')) = 806.96, 'customer report shows the same total');
select pg_temp.ok((select total_selling from public.get_order_margin_summary()) = 806.96, 'margin summary counts selling net of the discount');
reset role;

-- Editing keeps the prices the order was taken at.
update public.price_history set effective_to = now() where product_id = '00000000-0000-0000-0000-00000000b001';
insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by) values
  ('00000000-0000-0000-0000-00000000b001', 70, 99, now(), '00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format($q$select public.edit_order_with_items(%L, jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c001', 'requested_delivery_date', current_date), '[{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":12,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b003","quantity":2,"unit_of_measurement":"kg"}]'::jsonb)$q$, (select id from ids where name = 'o1'))) is null, 'office can edit an unverified order');
select pg_temp.ok((select unit_price from order_items where order_id = (select id from ids where name = 'o1') and product_id = '00000000-0000-0000-0000-00000000b001') = 85, 'a kept line keeps its original price after a price change');
select pg_temp.ok((select unit_price from order_items where order_id = (select id from ids where name = 'o1') and product_id = '00000000-0000-0000-0000-00000000b003') = 80, 'a new line gets the current price');
-- 12 x 85 + 2 x 80 = 1180; 10% = 118; total 1062.
select pg_temp.ok((select public.order_total(o) = 1062 from orders o where id = (select id from ids where name = 'o1')), 'a percent discount follows the new subtotal');

-- A special price approved by an administrator survives an edit.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
insert into ids values ('o2', public.create_order_with_items(
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c002', 'order_source', 'phone', 'requested_delivery_date', current_date),
  '[{"product_id":"00000000-0000-0000-0000-00000000b002","quantity":5,"unit_of_measurement":"kg","special_price":120,"special_price_reason":"Regular customer"}]'::jsonb));
select public.apply_order_discount((select id from ids where name = 'o2'), 'fixed', 500, 'Delayed delivery compensation', gen_random_uuid());
select public.edit_order_with_items((select id from ids where name = 'o2'), jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c002', 'requested_delivery_date', current_date), '[{"product_id":"00000000-0000-0000-0000-00000000b002","quantity":6,"unit_of_measurement":"kg"}]'::jsonb);
reset role;
select pg_temp.ok((select unit_price = 120 and special_price = 120 and special_price_reason = 'Regular customer' from order_items where order_id = (select id from ids where name = 'o2')), 'an approved special price survives an edit');
select pg_temp.ok((select public.order_subtotal(o) = 720 and public.order_discount(o) = 500 and public.order_total(o) = 220 from orders o where id = (select id from ids where name = 'o2')), 'peso discount applies after the special price');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', format($q$select public.edit_order_with_items(%L, jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c002', 'requested_delivery_date', current_date), '[{"product_id":"00000000-0000-0000-0000-00000000b002","quantity":4,"unit_of_measurement":"kg"}]'::jsonb)$q$, (select id from ids where name = 'o2'))) like 'The discount is more than the new subtotal of 480.00%', 'an edit that drops the subtotal below a peso discount is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', format($q$select public.edit_order_with_items(%L, jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c001', 'requested_delivery_date', current_date), '[{"product_id":"00000000-0000-0000-0000-00000000b002","quantity":6,"unit_of_measurement":"kg"}]'::jsonb)$q$, (select id from ids where name = 'o2'))) is null, 'changing the customer is allowed');
select pg_temp.ok((select unit_price = 140 and special_price is null from order_items where order_id = (select id from ids where name = 'o2')), 'changing the customer re-prices every line');

-- Removing a discount needs a reason, and the log keeps what was removed.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.remove_order_discount(%L, '' '', gen_random_uuid())', (select id from ids where name = 'o2'))) = 'A reason is required to remove a discount', 'removing a discount without a reason is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.remove_order_discount(%L, ''Customer changed customer'', gen_random_uuid())', (select id from ids where name = 'o2'))) is null, 'office can remove a discount with a reason');
select pg_temp.ok((select details->>'reason' = 'Customer changed customer' and details->'previous'->>'type' = 'fixed' and (details->'previous'->>'value')::numeric = 500 from order_activity where order_id = (select id from ids where name = 'o2') and action = 'discount_removed'), 'the removal logs the reason and the discount that was removed');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.remove_order_discount(%L, ''Again'', gen_random_uuid())', (select id from ids where name = 'o2'))) = 'This order has no discount', 'there is nothing to remove twice');

-- SI#.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.set_sales_invoice_number(%L, ''  13451 '', null, gen_random_uuid())', (select id from ids where name = 'o1'))) is null, 'office can set SI#');
select pg_temp.ok((select sales_invoice_number from orders where id = (select id from ids where name = 'o1')) = '13451', 'SI# is stored trimmed');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.set_sales_invoice_number(%L, ''13451; drop'', null, gen_random_uuid())', (select id from ids where name = 'o1'))) like 'Use up to 40%', 'SI# with odd characters is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.set_sales_invoice_number(%L, '''', null, gen_random_uuid())', (select id from ids where name = 'o1'))) is null, 'an empty SI# is accepted');
select pg_temp.ok((select sales_invoice_number from orders where id = (select id from ids where name = 'o1')) is null, 'an empty SI# removes it');
select pg_temp.ok((select count(*) from order_activity where order_id = (select id from ids where name = 'o1') and action = 'sales_invoice_set') = 2, 'each SI# change is logged');

-- Completed and cancelled orders.
update public.orders set status = 'completed' where id = (select id from ids where name = 'o1');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', format('select public.apply_order_discount(%L, ''fixed'', 10, ''Late'', gen_random_uuid())', (select id from ids where name = 'o1'))) = 'Discounts cannot be changed on a completed or cancelled order', 'a completed order refuses a discount');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', format('select public.remove_order_discount(%L, ''Customer paid in full'', gen_random_uuid())', (select id from ids where name = 'o1'))) = 'Discounts cannot be changed on a completed or cancelled order', 'a completed order keeps its discount');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.set_sales_invoice_number(%L, ''SI-2026/0042'', null, gen_random_uuid())', (select id from ids where name = 'o1'))) is null, 'office can add a missing SI# to a completed order');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.set_sales_invoice_number(%L, ''SI-2026/0043'', ''Typo'', gen_random_uuid())', (select id from ids where name = 'o1'))) = 'Only an administrator can change or remove the SI# of a completed order', 'office cannot replace the SI# of a completed order');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.set_sales_invoice_number(%L, '''', ''Wrong order'', gen_random_uuid())', (select id from ids where name = 'o1'))) = 'Only an administrator can change or remove the SI# of a completed order', 'office cannot clear the SI# of a completed order');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', format('select public.set_sales_invoice_number(%L, ''SI-2026/0043'', ''  '', gen_random_uuid())', (select id from ids where name = 'o1'))) = 'A reason is required to change or remove the SI# of a completed order', 'an administrator needs a reason to replace a completed order''s SI#');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', format('select public.set_sales_invoice_number(%L, ''SI-2026/0043'', ''Typo on the invoice'', gen_random_uuid())', (select id from ids where name = 'o1'))) is null, 'an administrator can replace a completed order''s SI# with a reason');
select pg_temp.ok((select details = jsonb_build_object('from', 'SI-2026/0042', 'to', 'SI-2026/0043', 'reason', 'Typo on the invoice') from order_activity where order_id = (select id from ids where name = 'o1') and action = 'sales_invoice_set' order by created_at desc, id limit 1)
  or exists (select 1 from order_activity where order_id = (select id from ids where name = 'o1') and action = 'sales_invoice_set' and details = jsonb_build_object('from', 'SI-2026/0042', 'to', 'SI-2026/0043', 'reason', 'Typo on the invoice')), 'the replacement logs the previous value, the new value and the reason');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', format('select public.set_sales_invoice_number(%L, ''SI-2026/0043'', null, gen_random_uuid())', (select id from ids where name = 'o1'))) is null, 'saving the same SI# again needs no reason');
-- Duplicates are allowed: one invoice can cover several orders.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.set_sales_invoice_number(%L, ''SI-2026/0043'', null, gen_random_uuid())', (select id from ids where name = 'o2'))) is null, 'the same SI# may be on two orders');
update public.orders set status = 'cancelled' where id = (select id from ids where name = 'o2');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.set_sales_invoice_number(%L, ''13452'', null, gen_random_uuid())', (select id from ids where name = 'o2'))) = 'A cancelled order cannot get a sales invoice number', 'a cancelled order refuses SI#');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000c1', format('select public.remove_order_discount(%L, ''Customer paid in full'', gen_random_uuid())', (select id from ids where name = 'o2'))) = 'Discounts cannot be changed on a completed or cancelled order', 'a cancelled order refuses discount changes');

-- Lookup tables.
select pg_temp.ok((select count(*) from order_sources) = 5, 'order sources are seeded from the old enum values');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select pg_temp.ok((select count(*) from order_sources) = 5, 'active staff can read order sources');
reset role;
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000000a1', 'insert into public.order_sources (label) values (''Walk-in'')') like 'permission denied%', 'order sources cannot be written through the API yet');
rollback;
