-- Some business data, written before the fix migration runs.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'admin@meah.test');
update public.profiles set role = 'administrator', status = 'active' where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.customers (customer_code, business_name) values ('C-1', 'Casa Verde');
insert into public.products (product_name) values ('Tomatoes'), ('Onions');
insert into public.product_skus (product_id, buying_sku, selling_sku, unit_of_measurement)
  select id, 'B-' || product_name, case when product_name = 'Onions' then null else 'S-' || product_name end, 'kg' from public.products;
insert into public.inventory (sku_id, current_quantity, low_stock_threshold) select id, 5, 10 from public.product_skus;
update public.products set track_stock = true;
