-- Delete product (prototype B5, 8 Nov 2026): administrators and administrative
-- staff only; the product leaves Products & stock and new orders, past orders
-- keep it, and it can't be restored.
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
insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000c161', 'D16-001', 'Casa Verde');
insert into public.products (id, product_name, unit_of_measurement) values
  ('00000000-0000-0000-0000-00000000b161', 'D16 Kangkong', 'bundle'),
  ('00000000-0000-0000-0000-00000000b162', 'D16 Pechay', 'kg');
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000016e1', '00000000-0000-0000-0000-00000000c161', 'phone', '00000000-0000-0000-0000-0000000016c1', 'completed', current_date - 3);
insert into public.order_items (order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price) values
  ('00000000-0000-0000-0000-0000000016e1', '00000000-0000-0000-0000-00000000b161', 4, 'bundle', 25, 25, 15);

select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000016f1', $q$select public.delete_product('00000000-0000-0000-0000-00000000b161', gen_random_uuid())$q$) like 'Only administrators and administrative staff can delete products%',
  'purchasing staff can''t delete a product');
select pg_temp.err('00000000-0000-0000-0000-0000000016f1', $q$update public.products set deleted_at = now() where id = '00000000-0000-0000-0000-00000000b161'$q$);
select pg_temp.ok((select deleted_at is null from public.products where id = '00000000-0000-0000-0000-00000000b161'), 'nor by writing the table directly');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000016c1', $q$select public.delete_product('00000000-0000-0000-0000-00000000b161', '00000000-0000-0000-0000-0000000016aa')$q$)->>'deleted')::boolean,
  'administrative staff delete it');
select pg_temp.ok((select status = 'archived' and deleted_at is not null and deleted_by = '00000000-0000-0000-0000-0000000016c1' from public.products where id = '00000000-0000-0000-0000-00000000b161'),
  'it is kept as a record: archived, with who deleted it and when');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000016c1', $q$select public.delete_product('00000000-0000-0000-0000-00000000b161', '00000000-0000-0000-0000-0000000016aa')$q$)->>'deleted')::boolean,
  'a retry of the same request is answered again, not refused');
select pg_temp.ok((pg_temp.run('00000000-0000-0000-0000-0000000016a1', $q$select jsonb_build_object('n', count(*)) from public.get_products_overview() where product_name like 'D16 %'$q$)->>'n')::int = 1
  and (pg_temp.run('00000000-0000-0000-0000-0000000016a1', $q$select jsonb_build_object('n', count(*)) from public.get_products_overview() where product_name = 'D16 Kangkong'$q$)->>'n')::int = 0,
  'it leaves Products & stock, including the Archived list');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000016c1', $q$select public.create_order(jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c161', 'requested_delivery_date', current_date + 1, 'order_source_id', (select id from public.order_sources where code = 'viber')),
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-00000000b161', 'quantity', 1, 'unit_of_measurement', 'bundle')), gen_random_uuid())$q$) = 'Selected product is unavailable',
  'it can''t go on a new order');
select pg_temp.ok((select count(*) = 1 and sum(quantity) = 4 from public.order_items where order_id = '00000000-0000-0000-0000-0000000016e1')
  and (pg_temp.run('00000000-0000-0000-0000-0000000016c1', $q$select jsonb_build_object('name', p.product_name) from public.order_items i join public.products p on p.id = i.product_id where i.order_id = '00000000-0000-0000-0000-0000000016e1'$q$)->>'name') = 'D16 Kangkong',
  'past orders keep the line and still show the product''s name');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000016a1', $q$select public.set_product_archived('00000000-0000-0000-0000-00000000b161', false, gen_random_uuid())$q$) = 'D16 Kangkong was deleted and can''t be restored.',
  'restoring it is refused');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000016a1', $q$update public.products set status = 'active', deleted_at = null where id = '00000000-0000-0000-0000-00000000b161'$q$) = 'D16 Kangkong was deleted and can''t be restored.',
  'also when the table is written directly');
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000016c1', $q$select public.delete_product('00000000-0000-0000-0000-0000000016ff', gen_random_uuid())$q$) = 'Product not found', 'an unknown product is reported');
rollback;
