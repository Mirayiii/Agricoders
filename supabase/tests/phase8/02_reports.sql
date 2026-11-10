-- Phase 8 reports: administrator-only, totals after discounts, cost coverage,
-- compatible-unit volume and the customer statement.
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

begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a1', 'admin9@meah.test', '{"full_name":"Ana Mercado"}'),
  ('00000000-0000-0000-0000-0000000009c1', 'office9@meah.test', '{"full_name":"Liza Office"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000009a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000009c1';
insert into public.customers (id, customer_code, business_name, brand_name, tin) values
  ('00000000-0000-0000-0000-0000000009c0', 'R8-001', 'Casa Verde Holdings Inc.', 'Casa Verde', '012-345-678-000'),
  ('00000000-0000-0000-0000-0000000009c9', 'R8-002', 'Luntian Grocers', null, null);
insert into public.products (id, product_name, unit_of_measurement) values
  ('00000000-0000-0000-0000-0000000009b1', 'R8 Onions', 'kg'),
  ('00000000-0000-0000-0000-0000000009b2', 'R8 Tomatoes', 'kg'),
  ('00000000-0000-0000-0000-0000000009b3', 'R8 Eggs', 'piece'),
  ('00000000-0000-0000-0000-0000000009b4', 'R8 Garlic', 'kg');

-- Casa Verde, inside the period:
--  A confirmed: 10 kg onions at ₱100 (cost ₱80) + 2 kg tomatoes at ₱50 (no cost
--    recorded), less a ₱110 discount = ₱990.
--  B completed: 500 g onions at ₱0.12/g (cost ₱0.10/g) = ₱60, and 1 dozen eggs
--    at ₱90 (cost ₱72).
--  C cancelled: 5 kg onions. D for verification: 3 kg onions.
-- Luntian, inside the period: E completed: 4 kg onions at ₱100 (cost ₱80).
-- Casa Verde, before the period: F completed: 1 kg onions.
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date, discount_type, discount_value, discount_reason, discount_by, discount_at) values
  ('00000000-0000-0000-0000-00000000090a', '00000000-0000-0000-0000-0000000009c0', 'phone', '00000000-0000-0000-0000-0000000009c1', 'confirmed', current_date - 2, 'fixed', 110, 'Loyal customer', '00000000-0000-0000-0000-0000000009a1', now()),
  ('00000000-0000-0000-0000-00000000090b', '00000000-0000-0000-0000-0000000009c0', 'phone', '00000000-0000-0000-0000-0000000009c1', 'completed', current_date - 1, null, null, null, null, null),
  ('00000000-0000-0000-0000-00000000090c', '00000000-0000-0000-0000-0000000009c0', 'phone', '00000000-0000-0000-0000-0000000009c1', 'cancelled', current_date - 1, null, null, null, null, null),
  ('00000000-0000-0000-0000-00000000090d', '00000000-0000-0000-0000-0000000009c0', 'phone', '00000000-0000-0000-0000-0000000009c1', 'for_verification', current_date, null, null, null, null, null),
  ('00000000-0000-0000-0000-00000000090e', '00000000-0000-0000-0000-0000000009c9', 'phone', '00000000-0000-0000-0000-0000000009c1', 'completed', current_date - 2, null, null, null, null, null),
  ('00000000-0000-0000-0000-00000000090f', '00000000-0000-0000-0000-0000000009c0', 'phone', '00000000-0000-0000-0000-0000000009c1', 'completed', current_date - 30, null, null, null, null, null);
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price) values
  ('00000000-0000-0000-0000-00000000090a', '00000000-0000-0000-0000-0000000009b1', 10, 'kg', 100, 100, 80),
  ('00000000-0000-0000-0000-00000000090a', '00000000-0000-0000-0000-0000000009b2', 2, 'kg', 50, 50, 0),
  ('00000000-0000-0000-0000-00000000090b', '00000000-0000-0000-0000-0000000009b1', 500, 'g', 0.12, 0.12, 0.10),
  ('00000000-0000-0000-0000-00000000090b', '00000000-0000-0000-0000-0000000009b3', 1, 'dozen', 90, 90, 72),
  ('00000000-0000-0000-0000-00000000090c', '00000000-0000-0000-0000-0000000009b1', 5, 'kg', 100, 100, 80),
  ('00000000-0000-0000-0000-00000000090d', '00000000-0000-0000-0000-0000000009b1', 3, 'kg', 100, 100, 80),
  ('00000000-0000-0000-0000-00000000090e', '00000000-0000-0000-0000-0000000009b1', 4, 'kg', 100, 100, 80),
  ('00000000-0000-0000-0000-00000000090f', '00000000-0000-0000-0000-0000000009b1', 1, 'kg', 100, 100, 80);

create temp table t (name text primary key, value jsonb) on commit drop;
grant all on t to authenticated;

-- ---------------------------------------------------------------------------
-- Administrators only, checked on the server
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009c1', 'select public.get_sales_report(current_date - 7, current_date)') = 'Reports are available to administrators only', 'administrative staff can''t open the sales report');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009c1', $q$select public.get_customer_statement('00000000-0000-0000-0000-0000000009c0', current_date - 7, current_date)$q$) = 'Reports are available to administrators only', 'or a customer statement');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009c1', $q$select public.get_item_analytics('00000000-0000-0000-0000-0000000009b1', current_date - 7, current_date)$q$) = 'Reports are available to administrators only', 'or item analytics');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009c1', 'select public.get_daily_prices(current_date)') = 'Reports are available to administrators only', 'or daily price updates');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009c1', 'select count(*) from public.get_margin_report()') like '%administrators only%', 'the older report functions are administrator-only too');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009c1', 'select count(*) from public.get_margin_report_unchecked()') like 'permission denied%', 'and their unchecked versions can''t be called directly');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009c1', 'select count(*) from public.report_lines(null, null)') like 'permission denied%', 'nor the shared report lines');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009a1', 'select count(*) from public.get_margin_report()') is null, 'administrators still get the older reports');
update public.profiles set status = 'inactive' where id = '00000000-0000-0000-0000-0000000009a1';
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000009a1', 'select public.get_sales_report(current_date - 7, current_date)') = 'Reports are available to administrators only', 'a deactivated administrator can''t open reports');
update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-0000000009a1';

-- ---------------------------------------------------------------------------
-- Sales report
-- ---------------------------------------------------------------------------
insert into t values ('sales', pg_temp.run('00000000-0000-0000-0000-0000000009a1', 'select public.get_sales_report(current_date - 7, current_date)'));
insert into t select 'casa', c from t, jsonb_array_elements(value->'customers') c where name = 'sales' and c->>'name' = 'Casa Verde';
select pg_temp.ok((select (value->>'sales')::numeric = 1140 and (value->>'orders')::int = 2 from t where name = 'casa'),
  'customer sales count confirmed to completed orders after discounts (₱990 + ₱150), not cancelled or unverified ones');
select pg_temp.ok((select (value->>'covered_sales')::numeric = 1050 and (value->>'cost')::numeric = 922 and (value->>'profit')::numeric = 128 and (value->>'margin_percent')::numeric = 12.2 from t where name = 'casa'),
  'profit and margin use only lines with a cost (₱1,050 sales, ₱922 cost, 12.2%)');
select pg_temp.ok((select (value->>'lines_without_cost')::int = 1 from t where name = 'casa'), 'lines with no cost recorded are counted, not treated as free');
select pg_temp.ok((select value->'volume' @> '[{"unit":"kg","quantity":12.5},{"unit":"pc","quantity":12}]' and jsonb_array_length(value->'volume') = 2 from t where name = 'casa'),
  'volume adds compatible units (10 kg + 2 kg + 500 g = 12.5 kg; 1 dozen = 12 pieces) and keeps others apart');
select pg_temp.ok((select value->>'name' = 'Casa Verde' and value->>'code' = 'R8-001' from t where name = 'casa'), 'customers show their brand name');
select pg_temp.ok((select (value->'totals'->>'sales')::numeric >= 1540 from t where name = 'sales'), 'the overview totals include every customer');
select pg_temp.ok((select (d->>'sales')::numeric >= 1390 from t, jsonb_array_elements(value->'daily') d where name = 'sales' and (d->>'date')::date = current_date - 2), 'daily sales are by delivery date');
select pg_temp.ok((select jsonb_array_length(value->'daily') = 8 from t where name = 'sales'), 'every day of the period is listed, even without sales');
insert into t select 'onions', p from t, jsonb_array_elements(value->'products') p where name = 'sales' and p->>'name' = 'R8 Onions';
select pg_temp.ok((select (value->>'main_volume')::numeric = 14.5 and (value->>'clients')::int = 2 from t where name = 'onions'), 'product volume is in the product''s unit (10 + 0.5 + 4 = 14.5 kg) with its client count');
select pg_temp.ok((select (p->>'main_volume')::numeric = 0 and (p->>'orders')::int = 0 from t, jsonb_array_elements(value->'products') p where name = 'sales' and p->>'name' = 'R8 Garlic')
  and (select (p->>'main_volume')::numeric = 12 from t, jsonb_array_elements(value->'products') p where name = 'sales' and p->>'name' = 'R8 Eggs'), 'products with no orders are listed with zero volume');

-- ---------------------------------------------------------------------------
-- Customer statement
-- ---------------------------------------------------------------------------
insert into t values ('statement', pg_temp.run('00000000-0000-0000-0000-0000000009a1', $q$select public.get_customer_statement('00000000-0000-0000-0000-0000000009c0', current_date - 7, current_date)$q$));
select pg_temp.ok((select value->'customer'->>'name' = 'Casa Verde' and value->'customer'->>'business_name' = 'Casa Verde Holdings Inc.' and value->'customer'->>'tin' = '012-345-678-000' from t where name = 'statement'),
  'the statement shows the brand name, business name and TIN#');
select pg_temp.ok((select array_agg(o->>'status' order by o->>'delivery_date', o->>'status') = array['confirmed', 'completed', 'for_verification'] from t, jsonb_array_elements(value->'orders') o where name = 'statement'),
  'it lists every order in the period that isn''t cancelled');
select pg_temp.ok((select (o->>'subtotal')::numeric = 1100 and (o->>'discount')::numeric = 110 and (o->>'total')::numeric = 990 and jsonb_array_length(o->'lines') = 2
  from t, jsonb_array_elements(value->'orders') o where name = 'statement' and o->>'status' = 'confirmed'), 'each order is itemized with its discount and total');
select pg_temp.ok((select (value->'totals'->>'sales')::numeric = 1140 from t where name = 'statement'), 'its totals match the customer report');
select pg_temp.ok((select jsonb_array_length(value->'orders') = 0 from (select pg_temp.run('00000000-0000-0000-0000-0000000009a1', $q$select public.get_customer_statement('00000000-0000-0000-0000-0000000009c0', current_date + 1, current_date + 7)$q$) as value) x),
  'a period with no orders gives an empty statement');

-- ---------------------------------------------------------------------------
-- Item analytics and daily prices
-- ---------------------------------------------------------------------------
insert into t values ('item', pg_temp.run('00000000-0000-0000-0000-0000000009a1', $q$select public.get_item_analytics('00000000-0000-0000-0000-0000000009b1', current_date - 7, current_date)$q$));
select pg_temp.ok((select jsonb_array_length(value->'customers') = 2 and (value->'customers'->0->>'name') = 'Casa Verde' and (value->'customers'->0->>'main_volume')::numeric = 10.5 from t where name = 'item'),
  'item analytics ranks customers by volume in the product''s unit');
insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by) values
  ('00000000-0000-0000-0000-0000000009b1', 80, 100, now() - interval '3 days', '00000000-0000-0000-0000-0000000009a1'),
  ('00000000-0000-0000-0000-0000000009b2', 0, 50, now() - interval '3 days', '00000000-0000-0000-0000-0000000009a1');
insert into t values ('daily', pg_temp.run('00000000-0000-0000-0000-0000000009a1', 'select public.get_daily_prices(public.manila_today())'));
select pg_temp.ok((select (p->>'margin_percent')::numeric = 20.0 from t, jsonb_array_elements(value->'products') p where name = 'daily' and p->>'name' = 'R8 Onions')
  and (select p->'margin_percent' = 'null'::jsonb and (p->>'selling_price')::numeric = 50 from t, jsonb_array_elements(value->'products') p where name = 'daily' and p->>'name' = 'R8 Tomatoes'),
  'daily prices show margin on the selling price, and none when no cost is recorded');

-- Margin rule: (selling - cost) / selling; blank without a cost or a selling price.
select pg_temp.ok(public.margin_percent(105, 140) = 25.0 and public.margin_percent(0, 140) is null and public.margin_percent(null, 140) is null
  and public.margin_percent(50, 0) is null and public.margin_percent(150, 140) = -7.1, 'margin_percent handles missing cost, zero selling price and selling at a loss');
rollback;
