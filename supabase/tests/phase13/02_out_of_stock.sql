-- Out-of-stock products can't be added to orders (Jac, 8 Nov 2026, prototype
-- rule): tracked products with no stock are refused on every way a line is
-- added; saved lines, untracked products and low stock are not affected.
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
  ('00000000-0000-0000-0000-0000000016a1', 'admin16@meah.test', '{"full_name":"Ana Admin"}'),
  ('00000000-0000-0000-0000-0000000016c1', 'office16@meah.test', '{"full_name":"Liza Office"}'),
  ('00000000-0000-0000-0000-0000000016f1', 'packer16@meah.test', '{"full_name":"Pia Packer"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000016a1';
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000016c1';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id = '00000000-0000-0000-0000-0000000016f1';

insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000c161', 'S16-001', 'Casa Verde');
-- b161 tracked, 0 kg (out); b162 tracked, 3 kg (low); b163 untracked with a 0 record;
-- b164 tracked with no stock record (unknown, not 0); b165 tracked: 0 by the sack, 10 by the kg.
insert into public.products (id, product_name, unit_of_measurement, track_stock) values
  ('00000000-0000-0000-0000-00000000b161', 'S16 Onions', 'kg', true),
  ('00000000-0000-0000-0000-00000000b162', 'S16 Garlic', 'kg', true),
  ('00000000-0000-0000-0000-00000000b163', 'S16 Ginger', 'kg', false),
  ('00000000-0000-0000-0000-00000000b164', 'S16 Lemons', 'kg', true),
  ('00000000-0000-0000-0000-00000000b165', 'S16 Rice', 'kg', true);
insert into public.product_skus (id, product_id, selling_sku, unit_of_measurement) values
  ('00000000-0000-0000-0000-0000000016b1', '00000000-0000-0000-0000-00000000b161', 'S16-ONI', 'kg'),
  ('00000000-0000-0000-0000-0000000016b2', '00000000-0000-0000-0000-00000000b162', 'S16-GAR', 'kg'),
  ('00000000-0000-0000-0000-0000000016b3', '00000000-0000-0000-0000-00000000b163', 'S16-GIN', 'kg'),
  ('00000000-0000-0000-0000-0000000016b4', '00000000-0000-0000-0000-00000000b164', 'S16-LEM', 'kg'),
  ('00000000-0000-0000-0000-0000000016b5', '00000000-0000-0000-0000-00000000b165', 'S16-RIC-KG', 'kg'),
  ('00000000-0000-0000-0000-0000000016b6', '00000000-0000-0000-0000-00000000b165', 'S16-RIC-SK', 'sack');
insert into public.inventory (sku_id, current_quantity, low_stock_threshold) values
  ('00000000-0000-0000-0000-0000000016b1', 0, 5),
  ('00000000-0000-0000-0000-0000000016b2', 3, 5),
  ('00000000-0000-0000-0000-0000000016b3', 0, null),
  ('00000000-0000-0000-0000-0000000016b5', 10, null),
  ('00000000-0000-0000-0000-0000000016b6', 0, null);
insert into public.price_history (product_id, product_sku_id, cost_price, selling_price, effective_from, created_by)
select p.id, null, 50, 100, now() - interval '1 day', '00000000-0000-0000-0000-0000000016a1' from public.products p where p.product_name like 'S16 %';
insert into public.price_history (product_id, product_sku_id, cost_price, selling_price, effective_from, created_by) values
  ('00000000-0000-0000-0000-00000000b165', '00000000-0000-0000-0000-0000000016b6', 1000, 1500, now() - interval '1 day', '00000000-0000-0000-0000-0000000016a1');

create function pg_temp.order_json() returns jsonb language sql as $$
  select jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c161', 'requested_delivery_date', current_date + 1,
    'order_source_id', (select id from public.order_sources where code = 'viber'));
$$;
create function pg_temp.create(uid uuid, items text) returns text language sql as $$
  select pg_temp.err(uid, format($q$select public.create_order(pg_temp.order_json(), %L::jsonb, gen_random_uuid())$q$, items));
$$;
create function pg_temp.line(p text, unit text default 'kg', sku text default null) returns text language sql as $$
  select format('{"product_id":"00000000-0000-0000-0000-00000000%s","quantity":2,"unit_of_measurement":"%s"%s}', p, unit,
    case when sku is null then '' else format(',"product_sku_id":"00000000-0000-0000-0000-0000000016%s"', sku) end);
$$;

-- New order
select pg_temp.ok(pg_temp.create('00000000-0000-0000-0000-0000000016c1', '[' || pg_temp.line('b161') || ']') = 'S16 Onions is out of stock. Remove it from the order, or update the stock first.',
  'a tracked product with 0 in stock is refused on New order, with its name');
select pg_temp.ok(pg_temp.create('00000000-0000-0000-0000-0000000016a1', '[' || pg_temp.line('b162') || ',' || pg_temp.line('b161') || ']') like 'S16 Onions is out of stock%'
  and not exists (select 1 from public.order_items i join public.products p on p.id = i.product_id where p.product_name like 'S16 %'),
  'the administrator is refused too, and nothing of the order is saved');
select pg_temp.ok(pg_temp.create('00000000-0000-0000-0000-0000000016c1', '[' || pg_temp.line('b162') || ']') is null, 'low stock (3 kg, alert at 5) can still be ordered');
select pg_temp.ok(pg_temp.create('00000000-0000-0000-0000-0000000016c1', '[{"product_id":"00000000-0000-0000-0000-00000000b162","quantity":9,"unit_of_measurement":"kg"}]') is null,
  'more than the stock on hand can still be ordered (the existing warning)');
select pg_temp.ok(pg_temp.create('00000000-0000-0000-0000-0000000016c1', '[' || pg_temp.line('b163') || ']') is null, 'an untracked product is never blocked, even with a 0 record');
select pg_temp.ok(pg_temp.create('00000000-0000-0000-0000-0000000016c1', '[' || pg_temp.line('b164') || ']') is null,
  'a tracked product with no stock record is unknown, not 0, so it is not blocked (Jac, 8 Nov afternoon)');
select pg_temp.ok(pg_temp.create('00000000-0000-0000-0000-0000000016c1', '[' || pg_temp.line('b165') || ']') is null, 'stock is per unit: Rice by the kg (10 on hand) is allowed');
select pg_temp.ok(pg_temp.create('00000000-0000-0000-0000-0000000016c1', '[' || pg_temp.line('b165', 'sack', 'b6') || ']') like 'S16 Rice is out of stock%', 'Rice by the sack (0 on hand) is refused');
select pg_temp.ok(pg_temp.create('00000000-0000-0000-0000-0000000016c1', '[' || pg_temp.line('b165', 'sack') || ']') like 'S16 Rice is out of stock%', 'the sack unit is refused without its SKU id too');

-- Offline orders replayed later
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000016c1', format($q$select public.offline_create_order(pg_temp.order_json(), %L::jsonb, gen_random_uuid(), jsonb_build_object('queued_at', now(), 'seen_prices', '[{"product_id":"00000000-0000-0000-0000-00000000b161","unit":"kg","price":100}]'::jsonb))$q$,
  '[' || pg_temp.line('b161') || ']')) like 'S16 Onions is out of stock%', 'an offline order replayed later is refused the same way');

-- Saved lines are kept when stock later runs out
create temp table t (name text primary key, value jsonb) on commit drop;
insert into t values ('o', pg_temp.run('00000000-0000-0000-0000-0000000016c1', format($q$select public.create_order(pg_temp.order_json(), %L::jsonb, gen_random_uuid())$q$,
  '[' || pg_temp.line('b162') || ',' || pg_temp.line('b163') || ']')));
update public.inventory set current_quantity = 0 where sku_id = '00000000-0000-0000-0000-0000000016b2';
create function pg_temp.oid() returns uuid language sql as $$ select (value->>'order_id')::uuid from t where name = 'o' $$;
create function pg_temp.edit(items text) returns text language sql as $$
  select pg_temp.err('00000000-0000-0000-0000-0000000016c1', format($q$select public.edit_order_with_items(%L,
    jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c161', 'requested_delivery_date', current_date + 2), %L::jsonb)$q$, pg_temp.oid(), items));
$$;
select pg_temp.ok(exists (select 1 from public.order_items where order_id = pg_temp.oid() and product_id = '00000000-0000-0000-0000-00000000b162'),
  'a saved line stays on the order after its stock runs out (nothing is removed)');
select pg_temp.ok(pg_temp.edit('[' || pg_temp.line('b162') || ',' || pg_temp.line('b163') || ']') is null,
  'Edit order still saves an order with that line unchanged');
select pg_temp.ok(pg_temp.edit('[{"product_id":"00000000-0000-0000-0000-00000000b162","quantity":1,"unit_of_measurement":"kg"},' || pg_temp.line('b163') || ']') is null,
  'and the saved line''s quantity can be lowered (2 to 1 kg)');
select pg_temp.ok((select quantity from public.order_items where order_id = pg_temp.oid() and product_id = '00000000-0000-0000-0000-00000000b162') = 1, 'the lower quantity is saved');
select pg_temp.ok(pg_temp.edit('[{"product_id":"00000000-0000-0000-0000-00000000b162","quantity":2,"unit_of_measurement":"kg"},' || pg_temp.line('b163') || ']')
    = 'S16 Garlic is out of stock, so its quantity can''t be raised above 1 kg. Keep or lower it, or update the stock first.',
  'but not raised again (1 to 2 kg): the server compares with the saved quantity (Jac, 8 Nov 15:24)');
select pg_temp.ok((select quantity from public.order_items where order_id = pg_temp.oid() and product_id = '00000000-0000-0000-0000-00000000b162') = 1, 'and the order is left unchanged');
select pg_temp.ok(pg_temp.edit('[{"product_id":"00000000-0000-0000-0000-00000000b162","quantity":1,"unit_of_measurement":"kg"},' || pg_temp.line('b163') || ',' || pg_temp.line('b161') || ']') like 'S16 Onions is out of stock%',
  'but adding an out-of-stock product in Edit order is refused');
select pg_temp.ok((select count(*) from public.order_items where order_id = pg_temp.oid()) = 2, 'and the order is left unchanged');
select pg_temp.ok(pg_temp.edit('[{"product_id":"00000000-0000-0000-0000-00000000b165","quantity":1,"unit_of_measurement":"sack","product_sku_id":"00000000-0000-0000-0000-0000000016b6"},' || pg_temp.line('b163') || ']') like 'S16 Rice is out of stock%',
  'switching a line to an out-of-stock unit is refused');

-- Order again copies an out-of-stock line: refused
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000016c1', format($q$select public.create_order(pg_temp.order_json(), %L::jsonb, gen_random_uuid(), %L)$q$,
  '[{"product_id":"00000000-0000-0000-0000-00000000b162","quantity":4,"unit_of_measurement":"kg"}]', pg_temp.oid())) like 'S16 Garlic is out of stock%',
  'Order again with a product that has since run out is refused');

-- Raising other kept lines: only a recorded 0 or less blocks it
update public.inventory set current_quantity = 3 where sku_id = '00000000-0000-0000-0000-0000000016b2';
insert into t values ('o2', pg_temp.run('00000000-0000-0000-0000-0000000016c1', format($q$select public.create_order(pg_temp.order_json(), %L::jsonb, gen_random_uuid())$q$,
  '[' || pg_temp.line('b162') || ',' || pg_temp.line('b163') || ',' || pg_temp.line('b164') || ',' || pg_temp.line('b165') || ']')));
update public.inventory set current_quantity = 0 where sku_id = '00000000-0000-0000-0000-0000000016b2';
create function pg_temp.edit2(garlic numeric, other numeric) returns text language sql as $$
  select pg_temp.err('00000000-0000-0000-0000-0000000016c1', format($q$select public.edit_order_with_items(%L,
    jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c161', 'requested_delivery_date', current_date + 2), %L::jsonb)$q$,
    (select (value->>'order_id')::uuid from t where name = 'o2'),
    format('[{"product_id":"00000000-0000-0000-0000-00000000b162","quantity":%s,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b163","quantity":%s,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b164","quantity":%s,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b165","quantity":%s,"unit_of_measurement":"kg"}]',
      garlic, other, other, other)));
$$;
select pg_temp.ok(pg_temp.edit2(2, 9) is null,
  'raising untracked Ginger, Lemons with no stock record, and in-stock Rice is allowed, next to an unchanged out-of-stock line');
select pg_temp.ok(pg_temp.edit2(3, 9) like 'S16 Garlic is out of stock, so its quantity can''t be raised above 2 kg%', 'raising the out-of-stock line in the same order is refused');
update public.inventory set current_quantity = 1 where sku_id = '00000000-0000-0000-0000-0000000016b2';
select pg_temp.ok(pg_temp.edit2(3, 9) is null, 'once stock is back above 0 the line can be raised again, even beyond the stock on hand (no quantity limit)');
update public.inventory set current_quantity = 0 where sku_id = '00000000-0000-0000-0000-0000000016b2';

-- History and owner scripts are never refused
select pg_temp.ok((select count(*) from public.order_items where order_id = pg_temp.oid()) = 2, 'past order lines are untouched by the stock change');
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price)
  values (pg_temp.oid(), '00000000-0000-0000-0000-00000000b161', 1, 'kg', 100, 100, 50);
select pg_temp.ok(true, 'an owner script or import can still write lines (the rule is for app calls)');

-- The screens' list of units that can't be ordered: no quantities, order takers only
select pg_temp.ok((select jsonb_agg(value order by value) from jsonb_array_elements_text(pg_temp.run('00000000-0000-0000-0000-0000000016c1', $q$select jsonb_agg(sku_id) from public.get_out_of_stock_units(array(select id from public.products where product_name like 'S16 %'))$q$)))
  = '["00000000-0000-0000-0000-0000000016b1", "00000000-0000-0000-0000-0000000016b2", "00000000-0000-0000-0000-0000000016b6"]'::jsonb,
  'office staff get the out-of-stock units (Onions, Garlic now, Rice by the sack); never untracked Ginger, Rice by the kg or Lemons with no stock record');
select pg_temp.ok(pg_temp.run('00000000-0000-0000-0000-0000000016f1', $q$select to_jsonb(count(*)) from public.get_out_of_stock_units(array(select id from public.products where product_name like 'S16 %'))$q$)::int = 0,
  'purchasing staff, who don''t take orders, get nothing');
rollback;
