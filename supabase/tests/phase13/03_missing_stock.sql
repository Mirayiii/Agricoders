-- A missing stock record is not zero stock (Jac, 8 Nov 2026 afternoon):
-- reads return unknown (null) instead of 0, the order rule blocks only a
-- recorded 0, and turning tracking on stores an explicit 0 with history.
\set ON_ERROR_STOP 1
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if;
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
  ('00000000-0000-0000-0000-0000000017a1', 'admin17@meah.test', '{"full_name":"Ana Admin"}');
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000017a1';

-- b171 tracked, no record; b172 tracked, 0 recorded; b173 tracked, 6 recorded.
insert into public.products (id, product_name, unit_of_measurement, track_stock) values
  ('00000000-0000-0000-0000-00000000b171', 'S17 Lemons', 'kg', true),
  ('00000000-0000-0000-0000-00000000b172', 'S17 Onions', 'kg', true),
  ('00000000-0000-0000-0000-00000000b173', 'S17 Garlic', 'kg', true);
insert into public.product_skus (id, product_id, selling_sku, unit_of_measurement) values
  ('00000000-0000-0000-0000-0000000017b1', '00000000-0000-0000-0000-00000000b171', 'S17-LEM', 'kg'),
  ('00000000-0000-0000-0000-0000000017b2', '00000000-0000-0000-0000-00000000b172', 'S17-ONI', 'kg'),
  ('00000000-0000-0000-0000-0000000017b3', '00000000-0000-0000-0000-00000000b173', 'S17-GAR', 'kg');
insert into public.inventory (sku_id, current_quantity, low_stock_threshold) values
  ('00000000-0000-0000-0000-0000000017b2', 0, null),
  ('00000000-0000-0000-0000-0000000017b3', 6, null);
insert into public.price_history (product_id, product_sku_id, cost_price, selling_price, effective_from, created_by)
select p.id, null, 50, 100, now() - interval '1 day', '00000000-0000-0000-0000-0000000017a1' from public.products p where p.product_name like 'S17 %';

create function pg_temp.avail(p text) returns jsonb language sql as $$
  select pg_temp.run('00000000-0000-0000-0000-0000000017a1', format($q$select to_jsonb(a) from public.get_product_inventory_availability(array['00000000-0000-0000-0000-00000000%s'::uuid]) a$q$, p));
$$;
create function pg_temp.overview(p text) returns jsonb language sql as $$
  select pg_temp.run('00000000-0000-0000-0000-0000000017a1', format($q$select to_jsonb(o) from public.get_products_overview() o where o.id = '00000000-0000-0000-0000-00000000%s'$q$, p));
$$;

-- Reads
select pg_temp.ok(pg_temp.avail('b171') ? 'current_quantity' and pg_temp.avail('b171')->'current_quantity' = 'null'::jsonb and pg_temp.avail('b171')->'status' = 'null'::jsonb,
  'New order availability: no stock record gives an unknown quantity and status, not 0');
select pg_temp.ok((pg_temp.avail('b172')->>'current_quantity')::numeric = 0 and pg_temp.avail('b172')->>'status' = 'out_of_stock',
  'a recorded 0 is still Out of stock');
select pg_temp.ok(pg_temp.overview('b171')->'stock_quantity' = 'null'::jsonb and pg_temp.overview('b171')->'stock_status' = 'null'::jsonb and (pg_temp.overview('b171')->>'track_stock')::boolean,
  'Products & stock: a tracked product with no record shows unknown stock, not 0');
select pg_temp.ok((pg_temp.overview('b173')->>'stock_quantity')::numeric = 6, 'a recorded count is shown as before');

-- To buy: unknown stock gives no "buy X more"
insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000c171', 'S17-001', 'Casa Verde');
select pg_temp.run('00000000-0000-0000-0000-0000000017a1', format($q$select public.create_order(%L::jsonb, %L::jsonb, gen_random_uuid())$q$,
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c171', 'requested_delivery_date', (now() at time zone 'Asia/Manila')::date,
    'order_source_id', (select id from public.order_sources where code = 'viber')),
  '[{"product_id":"00000000-0000-0000-0000-00000000b171","quantity":4,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b173","quantity":4,"unit_of_measurement":"kg"}]'));
-- Onions (a recorded 0) can't be ordered any more, so its demand is a saved line from before it ran out.
update public.inventory set current_quantity = 0 where sku_id = '00000000-0000-0000-0000-0000000017b3';
create function pg_temp.buy(name text) returns jsonb language sql as $$
  select x from jsonb_array_elements(pg_temp.run('00000000-0000-0000-0000-0000000017a1',
    $q$select public.get_buy_list(null, (now() at time zone 'Asia/Manila')::date)$q$)->'items') x where x->>'product_name' = name;
$$;
select pg_temp.ok(pg_temp.buy('S17 Lemons')->'stock' = 'null'::jsonb and pg_temp.buy('S17 Lemons')->'short_by' = 'null'::jsonb,
  'To buy: no stock record gives unknown stock and no short figure, not "buy 4 more"');
select pg_temp.ok((pg_temp.buy('S17 Garlic')->>'stock')::numeric = 0 and (pg_temp.buy('S17 Garlic')->>'short_by')::numeric = 4,
  'a recorded 0 still counts: buy 4 more');
update public.inventory set current_quantity = 6 where sku_id = '00000000-0000-0000-0000-0000000017b3';

-- Turning tracking on stores an explicit 0, with history
insert into public.products (id, product_name, unit_of_measurement, track_stock) values ('00000000-0000-0000-0000-00000000b174', 'S17 Ginger', 'kg', false);
insert into public.product_skus (id, product_id, selling_sku, unit_of_measurement) values
  ('00000000-0000-0000-0000-0000000017b4', '00000000-0000-0000-0000-00000000b174', 'S17-GIN', 'kg');
select pg_temp.ok(not exists (select 1 from public.inventory where sku_id = '00000000-0000-0000-0000-0000000017b4'), 'an untracked product has no stock record');
select pg_temp.run('00000000-0000-0000-0000-0000000017a1', $q$select public.update_product('00000000-0000-0000-0000-00000000b174', '{"track_stock":true}', gen_random_uuid())$q$);
select pg_temp.ok((select current_quantity from public.inventory where sku_id = '00000000-0000-0000-0000-0000000017b4') = 0,
  'turning on Track inventory stores a stock record of 0 for the unit');
select pg_temp.ok(exists (select 1 from public.inventory_transactions where sku_id = '00000000-0000-0000-0000-0000000017b4' and reason like 'Stock tracking turned on%'
  and performed_by = '00000000-0000-0000-0000-0000000017a1'), 'and records who turned it on in the stock history');
select pg_temp.ok((pg_temp.avail('b174')->>'current_quantity')::numeric = 0 and pg_temp.avail('b174')->>'status' = 'out_of_stock', 'so it now reads as a recorded 0 (Out of stock)');

select pg_temp.run('00000000-0000-0000-0000-0000000017a1', $q$select public.update_product('00000000-0000-0000-0000-00000000b174', '{"add_unit":"sack"}', gen_random_uuid())$q$);
select pg_temp.ok((select i.current_quantity from public.inventory i join public.product_skus ps on ps.id = i.sku_id
  where ps.product_id = '00000000-0000-0000-0000-00000000b174' and ps.unit_of_measurement = 'sack') = 0, 'a unit added to a tracked product starts at a recorded 0 too');

update public.inventory set current_quantity = 7 where sku_id = '00000000-0000-0000-0000-0000000017b4';
select pg_temp.run('00000000-0000-0000-0000-0000000017a1', $q$select public.update_product('00000000-0000-0000-0000-00000000b174', '{"track_stock":false}', gen_random_uuid())$q$);
select pg_temp.run('00000000-0000-0000-0000-0000000017a1', $q$select public.update_product('00000000-0000-0000-0000-00000000b174', '{"track_stock":true}', gen_random_uuid())$q$);
select pg_temp.ok((select current_quantity from public.inventory where sku_id = '00000000-0000-0000-0000-0000000017b4') = 7,
  'turning tracking off and on again never resets an existing count');
select pg_temp.ok(not exists (select 1 from public.inventory where sku_id = '00000000-0000-0000-0000-0000000017b1'),
  'units already tracked without a record are left alone, not silently set to 0');
rollback;
