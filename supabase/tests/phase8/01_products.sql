-- Phase 8 products and prices: permissions, archive instead of delete, units,
-- stock tracking, single and batch price updates.
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
  ('00000000-0000-0000-0000-0000000008a1', 'admin8@meah.test', '{"full_name":"Ana Mercado"}'),
  ('00000000-0000-0000-0000-0000000008c1', 'office8@meah.test', '{"full_name":"Liza Office"}'),
  ('00000000-0000-0000-0000-0000000008f1', 'purchasing8@meah.test', '{"full_name":"Pia Purchasing"}'),
  ('00000000-0000-0000-0000-0000000008d1', 'driver8@meah.test', '{"full_name":"Rico Driver"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000008a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000008c1';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id = '00000000-0000-0000-0000-0000000008f1';
update public.profiles set status = 'active', role = 'delivery_staff' where id = '00000000-0000-0000-0000-0000000008d1';
insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-0000000008c0', 'P8-001', 'Casa Verde');

create temp table t (name text primary key, value jsonb) on commit drop;
grant all on t to authenticated;
create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

-- ---------------------------------------------------------------------------
-- Add product
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008f1', $q$select public.create_product('{"product_name":"P8 Onions","units":["kg"]}', gen_random_uuid())$q$) like 'Only an administrator%', 'purchasing staff cannot add products');
-- Requirement PS-01: administrative staff no longer manage the catalog.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008c1', $q$select public.create_product('{"product_name":"P8 Onions","units":["kg"]}', gen_random_uuid())$q$) = 'Only an administrator can change products, prices and stock', 'administrative staff cannot add products (PS-01)');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', $q$select public.create_product('{"product_name":"  ","units":["kg"]}', gen_random_uuid())$q$) = 'Enter the product name', 'the product name is required');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', $q$select public.create_product('{"product_name":"P8 Onions","units":[]}', gen_random_uuid())$q$) = 'Choose at least one unit the product is sold by', 'a unit is required');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', $q$select public.create_product('{"product_name":"P8 Onions","units":["kg"],"cost_price":"50","selling_price":"0"}', gen_random_uuid())$q$) = 'The selling price must be more than ₱0', 'a zero selling price is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', $q$select public.create_product('{"product_name":"P8 Onions","units":["kg"],"selling_price":"80"}', gen_random_uuid())$q$) = 'Enter both the cost and the selling price, or neither', 'cost and selling price come together');

insert into t values ('onions', pg_temp.run('00000000-0000-0000-0000-0000000008a1',
  $q$select public.create_product('{"product_name":" P8  Red onions ","units":["kg","piece","sack (25kg)"],"default_unit":"kg","track_stock":true,"cost_price":"105","selling_price":"140","buying_sku":"p8-100002","selling_sku":"P8-101002"}', '88888888-8888-4888-8888-888888888801')$q$));
insert into t values ('onions_again', pg_temp.run('00000000-0000-0000-0000-0000000008a1',
  $q$select public.create_product('{"product_name":" P8  Red onions ","units":["kg","piece","sack (25kg)"],"default_unit":"kg","track_stock":true,"cost_price":"105","selling_price":"140","buying_sku":"p8-100002","selling_sku":"P8-101002"}', '88888888-8888-4888-8888-888888888801')$q$));
insert into ids select 'onions', (value->>'product_id')::uuid from t where name = 'onions';
select pg_temp.ok((select product_name = 'P8 Red onions' and unit_of_measurement = 'kg' and track_stock from public.products where id = (select id from ids where name = 'onions')), 'the administrator adds a product with its default unit and stock tracking');
select pg_temp.ok((select count(*) from public.products where product_name = 'P8 Red onions') = 1 and (select (value->>'replayed')::boolean from t where name = 'onions_again'), 'a retried Add product creates one product');
select pg_temp.ok((select array_agg(unit_of_measurement order by unit_of_measurement) from public.product_skus where product_id = (select id from ids where name = 'onions')) = array['kg', 'piece', 'sack (25kg)'], 'every unit it is sold by is saved');
select pg_temp.ok((select buying_sku = 'P8-100002' and selling_sku = 'P8-101002' from public.product_skus where product_id = (select id from ids where name = 'onions') and unit_of_measurement = 'kg'), 'the SKU codes go on the default unit, in capitals');
select pg_temp.ok((select cost_price = 105 and selling_price = 140 from public.price_history where product_id = (select id from ids where name = 'onions')), 'the first price is saved');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', $q$select public.create_product('{"product_name":"p8 red onions","units":["kg"]}', gen_random_uuid())$q$) = 'A product named p8 red onions already exists', 'a second product with the same name is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', $q$select public.create_product('{"product_name":"P8 Shallots","units":["kg"],"selling_sku":"P8-101002"}', gen_random_uuid())$q$) = 'Selling SKU P8-101002 is already used by P8 Red onions', 'a SKU code already in use is refused, naming the product');

-- A product without stock tracking, and one with no cost recorded.
insert into t values ('tomatoes', pg_temp.run('00000000-0000-0000-0000-0000000008a1', $q$select public.create_product('{"product_name":"P8 Tomatoes","units":["kg"],"cost_price":"62","selling_price":"85"}', gen_random_uuid())$q$));
insert into ids select 'tomatoes', (value->>'product_id')::uuid from t where name = 'tomatoes';
insert into t values ('honey', pg_temp.run('00000000-0000-0000-0000-0000000008a1', $q$select public.create_product('{"product_name":"P8 Honey","units":["bottle"],"cost_price":"0","selling_price":"380"}', gen_random_uuid())$q$));
insert into ids select 'honey', (value->>'product_id')::uuid from t where name = 'honey';
insert into t values ('ampalaya', pg_temp.run('00000000-0000-0000-0000-0000000008a1', $q$select public.create_product('{"product_name":"P8 Ampalaya","units":["kg"]}', gen_random_uuid())$q$));
insert into ids select 'ampalaya', (value->>'product_id')::uuid from t where name = 'ampalaya';

-- ---------------------------------------------------------------------------
-- Product list: margin, stock, who sees prices
-- ---------------------------------------------------------------------------
select public.adjust_inventory((select id from public.product_skus where product_id = (select id from ids where name = 'onions') and unit_of_measurement = 'kg'), 'adjustment', 18, 'Count', 20)
from (select pg_temp.as_user('00000000-0000-0000-0000-0000000008a1')) x;
insert into t values ('list_office', pg_temp.run('00000000-0000-0000-0000-0000000008a1', $q$select jsonb_object_agg(product_name, to_jsonb(p)) from public.get_products_overview() p where product_name like 'P8 %'$q$));
select pg_temp.ok((select (value->'P8 Red onions'->>'margin_percent')::numeric = 25.0 and (value->'P8 Red onions'->>'stock_quantity')::numeric = 18 and value->'P8 Red onions'->>'stock_status' = 'low_stock' from t where name = 'list_office'),
  'margin is on the selling price (₱140 vs ₱105 = 25.0%) and a tracked product shows its stock (18 kg, low)');
select pg_temp.ok((select (value->'P8 Red onions'->>'unit_count')::int = 3 from t where name = 'list_office'), 'the list counts the units');
select pg_temp.ok((select value->'P8 Tomatoes'->'stock_quantity' = 'null'::jsonb and value->'P8 Tomatoes'->'stock_status' = 'null'::jsonb from t where name = 'list_office'), 'a product without stock tracking shows no stock');
select pg_temp.ok((select value->'P8 Honey'->'margin_percent' = 'null'::jsonb and (value->'P8 Honey'->>'selling_price')::numeric = 380 from t where name = 'list_office'), 'no cost recorded: the price shows but the margin is left blank');
select pg_temp.ok((select value->'P8 Ampalaya'->'selling_price' = 'null'::jsonb from t where name = 'list_office'), 'a product with no price yet shows none');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008c1', $q$select count(*) from public.get_products_overview()$q$) = 'Only an administrator can open Products & stock', 'administrative staff cannot open Products & stock (SI-02, PS-02)');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008f1', $q$select count(*) from public.get_products_overview()$q$) = 'Only an administrator can open Products & stock', 'nor can purchasing staff');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008c1', format($q$select public.adjust_inventory(%L, 'adjustment', 5, 'Count', null)$q$, (select id from public.product_skus where product_id = (select id from ids where name = 'onions') and unit_of_measurement = 'kg'))) = 'Only an administrator can adjust stock', 'administrative staff cannot adjust stock (PS-03)');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008f1', format($q$select public.adjust_inventory(%L, 'adjustment', 5, 'Count', null)$q$, (select id from public.product_skus where product_id = (select id from ids where name = 'onions') and unit_of_measurement = 'kg'))) = 'Only an administrator can adjust stock', 'purchasing staff cannot adjust stock (PS-03)');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008c1', format($q$update public.products set product_name = 'P8 Renamed' where id = %L$q$, (select id from ids where name = 'onions'))) is null
  and (select product_name = 'P8 Red onions' from public.products where id = (select id from ids where name = 'onions')), 'administrative staff cannot change a product row directly');
-- Requirements SI-02 and PS-02: stock monitoring is the administrator's, also through direct reads.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008d1', $q$select count(*) from public.get_products_overview()$q$) = 'Only an administrator can open Products & stock', 'delivery staff no longer see stock levels');
select pg_temp.ok((select bool_and((pg_temp.run(u, $q$select to_jsonb(count(*)) from public.inventory$q$))::int = 0
    and (pg_temp.run(u, $q$select to_jsonb(count(*)) from public.inventory_transactions$q$))::int = 0
    and (pg_temp.run(u, $q$select to_jsonb(count(*)) from public.get_inventory_list(null, null, 100, 0)$q$))::int = 0
    and (pg_temp.run(u, $q$select to_jsonb(count(*)) from public.get_product_inventory_availability(array(select id from public.products))$q$))::int = 0)
  from unnest(array['00000000-0000-0000-0000-0000000008f1', '00000000-0000-0000-0000-0000000008d1']::uuid[]) u), 'purchasing and delivery staff read no stock levels directly');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000008c1', $q$select to_jsonb(count(*)) from public.inventory$q$))::int = 0
  and (pg_temp.run('00000000-0000-0000-0000-0000000008c1', $q$select to_jsonb(count(*)) from public.get_product_inventory_availability(array(select id from public.products))$q$))::int = 0,
  'administrative staff read no stock levels, not even the New order tag (SI-02, PS-02; replaces D-S1)');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000008a1', $q$select to_jsonb(count(*)) from public.get_product_inventory_availability(array(select id from public.products))$q$))::int > 0,
  'the administrator still gets stock availability on New order');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000008a1', $q$select to_jsonb(count(*)) from public.inventory$q$))::int > 0, 'the administrator reads stock');
update public.profiles set status = 'inactive' where id = '00000000-0000-0000-0000-0000000008d1';
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008d1', $q$select count(*) from public.get_products_overview()$q$) like 'Only an administrator%', 'a deactivated account cannot list products');
update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-0000000008d1';

-- ---------------------------------------------------------------------------
-- Details: units, codes, tracking
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"remove_unit":"kg"}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) = 'The default unit can''t be removed. Set another unit as default first.', 'the default unit can''t be removed');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"add_unit":"Piece"}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) = 'Piece is already one of this product''s units', 'a unit can''t be added twice');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"add_unit":"crate"}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) is null, 'a unit is added without needing a SKU code');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"remove_unit":"crate"}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) is null, 'runs: ' || 'a removed unit is kept for history, not deleted');
select pg_temp.ok((select status = 'archived' from public.product_skus where product_id = (select id from ids where name = 'onions') and unit_of_measurement = 'crate'), 'a removed unit is kept for history, not deleted');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"default_unit":"piece"}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) = 'Prices are set per kg. Enter the cost and selling price per piece to make it the default unit.', 'a priced product needs prices in the new unit before the default changes');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"default_unit":"piece","cost_price":12,"selling_price":0}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) = 'P8 Red onions: the selling price must be more than ₱0', 'and those prices are checked');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"add_unit":"bundle"}', gen_random_uuid())$q$, (select id from ids where name = 'ampalaya'))) is null, 'runs: add a unit to an unpriced product');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"default_unit":"bundle"}', gen_random_uuid())$q$, (select id from ids where name = 'ampalaya'))) is null, 'runs: another unit can be set as default');
select pg_temp.ok((select unit_of_measurement = 'bundle' from public.products where id = (select id from ids where name = 'ampalaya')), 'another unit can be set as default');
select pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"default_unit":"kg"}', gen_random_uuid())$q$, (select id from ids where name = 'ampalaya')));
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"remove_unit":"kg"}', gen_random_uuid())$q$, (select id from ids where name = 'tomatoes'))) is not null, 'a product always keeps one unit');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"selling_sku":"p8-201001","buying_sku":""}', gen_random_uuid())$q$, (select id from ids where name = 'tomatoes'))) is null, 'runs: ' || 'SKU codes can be edited and cleared');
select pg_temp.ok((select selling_sku = 'P8-201001' and buying_sku is null from public.product_skus where product_id = (select id from ids where name = 'tomatoes')), 'SKU codes can be edited and cleared');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"track_stock":false}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) is null, 'runs: turning stock tracking off');
select pg_temp.ok((select count(*) from public.inventory i join public.product_skus s on s.id = i.sku_id where s.product_id = (select id from ids where name = 'onions')) = 1, 'turning stock tracking off keeps the stock record');
select pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"track_stock":true}', gen_random_uuid())$q$, (select id from ids where name = 'onions')));

-- ---------------------------------------------------------------------------
-- Prices
-- ---------------------------------------------------------------------------
-- An order saved at today's price, before the price changes.
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date, created_at) values
  ('00000000-0000-0000-0000-0000000008e1', '00000000-0000-0000-0000-0000000008c0', 'phone', '00000000-0000-0000-0000-0000000008c1', 'confirmed', current_date + 1, now() - interval '1 day');
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price)
values ('00000000-0000-0000-0000-0000000008e1', (select id from ids where name = 'onions'), 2, 'kg', 140, 140, 105);
create temp table total_before on commit drop as select public.order_total(o) as total from public.orders o where id = '00000000-0000-0000-0000-0000000008e1';

select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.set_product_price(%L, 50, 0, gen_random_uuid())$q$, (select id from ids where name = 'onions'))) = 'P8 Red onions: the selling price must be more than ₱0', 'Update price refuses a zero selling price');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.set_product_price(%L, -1, 150, gen_random_uuid())$q$, (select id from ids where name = 'onions'))) = 'P8 Red onions: the cost can''t be negative', 'and a negative cost');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008f1', format($q$select public.set_product_price(%L, 100, 150, gen_random_uuid())$q$, (select id from ids where name = 'onions'))) like 'Only an administrator%', 'purchasing staff cannot change prices');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008c1', format($q$select public.set_product_price(%L, 100, 150, gen_random_uuid())$q$, (select id from ids where name = 'onions'))) like 'Only an administrator%', 'administrative staff cannot change prices (RE-05)');
insert into t values ('price', pg_temp.run('00000000-0000-0000-0000-0000000008a1', format($q$select public.set_product_price(%L, 110, 145, '88888888-8888-4888-8888-888888888802')$q$, (select id from ids where name = 'onions'))));
insert into t values ('price_again', pg_temp.run('00000000-0000-0000-0000-0000000008a1', format($q$select public.set_product_price(%L, 110, 145, '88888888-8888-4888-8888-888888888802')$q$, (select id from ids where name = 'onions'))));
select pg_temp.ok((select count(*) from public.price_history where product_id = (select id from ids where name = 'onions')) = 2, 'Update price adds a row once (a retry doesn''t add another) and keeps the old one');
select pg_temp.ok((select (value->>'margin_percent')::numeric = 24.1 from t where name = 'price'), 'the new margin is returned (₱145 vs ₱110 = 24.1%)');
select pg_temp.ok((select public.order_total(o) from public.orders o where id = '00000000-0000-0000-0000-0000000008e1') = (select total from total_before), 'an order saved before keeps its price and total');
insert into t values ('history', pg_temp.run('00000000-0000-0000-0000-0000000008a1', format($q$select jsonb_agg(to_jsonb(h)) from public.get_price_history(%L) h$q$, (select id from ids where name = 'onions'))));
select pg_temp.ok((select jsonb_array_length(value) = 2 and (value->0->>'selling_price')::numeric = 145 and (value->0->>'is_current')::boolean and value->0->>'set_by' = 'Ana Mercado' and not (value->1->>'is_current')::boolean from t where name = 'history'),
  'price history lists every price, newest first, with who set it');

-- ---------------------------------------------------------------------------
-- Batch price update: all or nothing
-- ---------------------------------------------------------------------------
create temp table count_before on commit drop as select count(*) as n from public.price_history;
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.batch_update_prices(public.manila_today(), %L, gen_random_uuid())$q$,
  jsonb_build_array(jsonb_build_object('product_id', (select id from ids where name = 'onions'), 'cost_price', 100, 'selling_price', 150),
                    jsonb_build_object('product_id', (select id from ids where name = 'tomatoes'), 'cost_price', 60, 'selling_price', 0)))) = 'P8 Tomatoes: the selling price must be more than ₱0',
  'one bad row refuses the whole batch, naming the product');
select pg_temp.ok((select count(*) from public.price_history) = (select n from count_before), 'and nothing from that batch is saved');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.batch_update_prices(public.manila_today() - 1, %L, gen_random_uuid())$q$,
  jsonb_build_array(jsonb_build_object('product_id', (select id from ids where name = 'onions'), 'cost_price', 100, 'selling_price', 150)))) = 'Prices can''t be backdated. Choose today or a later date.', 'prices can''t be backdated');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.batch_update_prices(public.manila_today(), %L, gen_random_uuid())$q$,
  jsonb_build_array(jsonb_build_object('product_id', (select id from ids where name = 'onions'), 'cost_price', 100, 'selling_price', 150),
                    jsonb_build_object('product_id', (select id from ids where name = 'onions'), 'cost_price', 90, 'selling_price', 150)))) = 'A product is listed twice', 'a product listed twice is refused');
insert into t values ('batch', pg_temp.run('00000000-0000-0000-0000-0000000008a1', format($q$select public.batch_update_prices(public.manila_today(), %L, '88888888-8888-4888-8888-888888888803')$q$,
  jsonb_build_array(jsonb_build_object('product_id', (select id from ids where name = 'onions'), 'cost_price', 100, 'selling_price', 150),
                    jsonb_build_object('product_id', (select id from ids where name = 'ampalaya'), 'cost_price', 120, 'selling_price', 145)))));
insert into t values ('batch_again', pg_temp.run('00000000-0000-0000-0000-0000000008a1', format($q$select public.batch_update_prices(public.manila_today(), %L, '88888888-8888-4888-8888-888888888803')$q$,
  jsonb_build_array(jsonb_build_object('product_id', (select id from ids where name = 'onions'), 'cost_price', 100, 'selling_price', 150),
                    jsonb_build_object('product_id', (select id from ids where name = 'ampalaya'), 'cost_price', 120, 'selling_price', 145)))));
select pg_temp.ok((select (value->>'updated')::int = 2 from t where name = 'batch') and (select count(*) from public.price_history) = (select n from count_before) + 2, 'a good batch saves every row once, even when retried');
select pg_temp.ok((select (public.product_price_at((select id from ids where name = 'ampalaya'), now())).selling_price = 145), 'today''s batch applies now');
-- Tomorrow's batch, then a correction to it.
select pg_temp.run('00000000-0000-0000-0000-0000000008a1', format($q$select public.batch_update_prices(public.manila_today() + 1, %L, gen_random_uuid())$q$,
  jsonb_build_array(jsonb_build_object('product_id', (select id from ids where name = 'tomatoes'), 'cost_price', 64, 'selling_price', 88))));
select pg_temp.run('00000000-0000-0000-0000-0000000008a1', format($q$select public.batch_update_prices(public.manila_today() + 1, %L, gen_random_uuid())$q$,
  jsonb_build_array(jsonb_build_object('product_id', (select id from ids where name = 'tomatoes'), 'cost_price', 63, 'selling_price', 86))));
select pg_temp.ok((select count(*) from public.price_history where product_id = (select id from ids where name = 'tomatoes')) = 2
  and (select (public.product_price_at((select id from ids where name = 'tomatoes'), now())).selling_price = 85)
  and (select (public.product_price_at((select id from ids where name = 'tomatoes'), now() + interval '2 days')).selling_price = 86),
  'a later date waits for that day; saving that date again replaces its prices before they take effect');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.set_product_price(%L, 60, 90, gen_random_uuid())$q$, (select id from ids where name = 'tomatoes'))) is null, 'runs: ' || 'today''s change doesn''t undo tomorrow''s price');
select pg_temp.ok((select (public.product_price_at((select id from ids where name = 'tomatoes'), now() + interval '2 days')).selling_price = 86), 'today''s change doesn''t undo tomorrow''s price');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.batch_update_prices(public.manila_today(), %L, gen_random_uuid())$q$,
  jsonb_build_array(jsonb_build_object('product_id', (select id from ids where name = 'tomatoes'), 'cost_price', 60, 'selling_price', 91)))) is null, 'today''s batch can still change today''s price');
insert into t values ('sheet', pg_temp.run('00000000-0000-0000-0000-0000000008a1', $q$select public.get_batch_price_sheet(public.manila_today() + 1)$q$));
select pg_temp.ok((select (x->>'selling_price')::numeric = 86 and (x->>'last_selling')::numeric = 91 from t, jsonb_array_elements(value->'products') x where name = 'sheet' and x->>'name' = 'P8 Tomatoes'),
  'the batch editor shows tomorrow''s prices against the last batch');

-- ---------------------------------------------------------------------------
-- Archive, never delete
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.err_owner(format($q$delete from public.products where id = %L$q$, (select id from ids where name = 'ampalaya'))) = 'Products are archived, not deleted, so past orders keep their records.', 'products cannot be deleted');
insert into t values ('archived', pg_temp.run('00000000-0000-0000-0000-0000000008a1', format($q$select public.set_product_archived(%L, true, gen_random_uuid())$q$, (select id from ids where name = 'onions'))));
select pg_temp.ok((select status = 'archived' and archived_at is not null from public.products where id = (select id from ids where name = 'onions')), 'the administrator archives a product');
select pg_temp.ok((select count(*) from public.order_items where order_id = '00000000-0000-0000-0000-0000000008e1') = 1
  and (select public.order_total(o) from public.orders o where id = '00000000-0000-0000-0000-0000000008e1') = (select total from total_before), 'past orders keep the archived product''s lines and totals');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008c1', format($q$select public.create_order(jsonb_build_object('customer_id', '00000000-0000-0000-0000-0000000008c0', 'requested_delivery_date', current_date + 1, 'order_source_id', (select id from public.order_sources where code = 'viber')), %L, gen_random_uuid())$q$,
  jsonb_build_array(jsonb_build_object('product_id', (select id from ids where name = 'onions'), 'quantity', 1, 'unit_of_measurement', 'kg'))))
  = 'Selected product is unavailable', 'an archived product can''t go on a new order');
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000008e2', '00000000-0000-0000-0000-0000000008c0', 'phone', '00000000-0000-0000-0000-0000000008c1', 'for_verification', current_date + 1);
select pg_temp.ok(pg_temp.err_owner(format($q$insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price) values ('00000000-0000-0000-0000-0000000008e2', %L, 1, 'kg', 140, 140, 105)$q$, (select id from ids where name = 'onions'))) = 'P8 Red onions is archived, so it can''t be added to new orders.',
  'nor be added to a newer order any other way');
select pg_temp.ok(pg_temp.err_owner(format($q$insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price) values ('00000000-0000-0000-0000-0000000008e1', %L, 1, 'kg', 140, 140, 105)$q$, (select id from ids where name = 'onions'))) is null,
  'an order saved before the product was archived can still be edited');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.set_product_price(%L, 100, 150, gen_random_uuid())$q$, (select id from ids where name = 'onions'))) = 'P8 Red onions: archived products can''t be priced', 'archived products can''t be priced');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.set_product_archived(%L, false, gen_random_uuid())$q$, (select id from ids where name = 'onions'))) is null, 'runs: ' || 'administrators restore a product');
select pg_temp.ok((select status = 'active' and archived_at is null from public.products where id = (select id from ids where name = 'onions')), 'administrators restore a product');
-- Changing the default unit of a priced product.
select pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"add_unit":"piece"}', gen_random_uuid())$q$, (select id from ids where name = 'tomatoes')));
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"default_unit":"piece","cost_price":10,"selling_price":15}', gen_random_uuid())$q$, (select id from ids where name = 'tomatoes'))) = 'A later price is scheduled per kg. Wait until it applies before changing the default unit.', 'the default unit can''t change while a later price in the old unit is waiting');
select pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"add_unit":"jar"}', gen_random_uuid())$q$, (select id from ids where name = 'honey')));
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"default_unit":"jar","cost_price":200,"selling_price":250}', gen_random_uuid())$q$, (select id from ids where name = 'honey'))) is null, 'runs: default unit with new prices');
select pg_temp.ok((select unit_of_measurement = 'jar' from public.products where id = (select id from ids where name = 'honey'))
  and (public.product_price_at((select id from ids where name = 'honey'), now())).selling_price = 250
  and (select count(*) from public.price_history where product_id = (select id from ids where name = 'honey')) = 2, 'a new default unit is saved with its own price, and the old price is kept in history');
-- Renaming units: history keeps its text; units with stock or prices keep their measure.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"rename_unit":{"from":"kg","to":"bag"}}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) = 'kg has stock on hand, so it can only be respelled as the same measure (for example kg to kilo). Add bag as a new unit instead.', 'a unit with stock can''t be renamed to a different measure');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"rename_unit":{"from":"kg","to":"Piece"}}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) = 'Piece is already one of this product''s units', 'a rename can''t duplicate another unit');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"rename_unit":{"from":"kg","to":"kilo"}}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) is null, 'runs: respell kg as kilo');
select pg_temp.ok((select unit_of_measurement = 'kilo' from public.products where id = (select id from ids where name = 'onions'))
  and exists (select 1 from public.product_skus where product_id = (select id from ids where name = 'onions') and unit_of_measurement = 'kilo')
  and (select unit_of_measurement = 'kg' from public.order_items where order_id = '00000000-0000-0000-0000-0000000008e1' limit 1)
  and exists (select 1 from public.product_unit_renames where product_id = (select id from ids where name = 'onions') and old_unit = 'kg' and new_unit = 'kilo'),
  'respelling keeps the measure; past order lines keep kg and the rename is logged');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008a1', format($q$select public.update_product(%L, '{"rename_unit":{"from":"sack (25kg)","to":"sack (50kg)"}}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) is null, 'runs: rename sack (25kg) to sack (50kg)');
select pg_temp.ok(exists (select 1 from public.product_skus where product_id = (select id from ids where name = 'onions') and unit_of_measurement = 'sack (50kg)'), 'a unit with no stock or prices can be renamed freely');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000008f1', format($q$select public.update_product(%L, '{"rename_unit":{"from":"piece","to":"pc"}}', gen_random_uuid())$q$, (select id from ids where name = 'onions'))) like 'Only an administrator%', 'purchasing staff can''t rename units');
rollback;
