-- Data as it could exist in the live database before the rollout (schema of
-- `main`, migrations up to 202609270003). Used by upgrade.sh. Amounts are
-- chosen so that rounding each line would change some totals: the upgrade
-- must keep every historical total exactly as it was.
\set ON_ERROR_STOP 1
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-0000-0000-000000000001', 'ana.mercado@meah.ph', '{"full_name":"Ana Mercado"}'),
  ('11111111-0000-0000-0000-000000000002', 'Liza.Ramos@meah.ph', '{"full_name":"Liza Ramos"}'),
  ('11111111-0000-0000-0000-000000000003', 'carlo@meah.ph', '{"full_name":"Carlo Diaz"}'),
  ('11111111-0000-0000-0000-000000000004', 'rico.b@meah.ph', '{"full_name":"Rico Bautista"}'),
  ('11111111-0000-0000-0000-000000000005', 'paul.s@meah.ph', '{"full_name":"Paul Santos"}'),
  ('11111111-0000-0000-0000-000000000006', 'rico.b@gmail.com', '{"full_name":"Rico B (old)"}');
update public.profiles set role = 'administrator', status = 'active' where id = '11111111-0000-0000-0000-000000000001';
update public.profiles set role = 'administrative_staff', status = 'active' where id = '11111111-0000-0000-0000-000000000002';
update public.profiles set role = 'fulfillment_staff', status = 'active' where id = '11111111-0000-0000-0000-000000000003';
update public.profiles set role = 'delivery_staff', status = 'active' where id = '11111111-0000-0000-0000-000000000004';
update public.profiles set role = 'delivery_staff', status = 'inactive' where id in ('11111111-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000006');

insert into public.customers (id, customer_code, business_name, contact_person, phone, delivery_address) values
  ('22222222-0000-0000-0000-000000000001', 'C-0001', 'Casa Verde Restaurant', 'Maria Santos', '0917 555 0101', '12 Mabini St., Makati'),
  ('22222222-0000-0000-0000-000000000002', 'C-0002', 'Luntian Grocers', null, null, null);
insert into public.customers (id, customer_code, business_name, status, archived_at) values
  ('22222222-0000-0000-0000-000000000003', 'C-0003', 'Old Bistro', 'archived', now() - interval '20 days');

insert into public.products (id, product_name, unit_of_measurement) values
  ('33333333-0000-0000-0000-000000000001', 'Tomatoes', 'kg'),
  ('33333333-0000-0000-0000-000000000002', 'Cabbage', 'head'),
  ('33333333-0000-0000-0000-000000000003', 'Calamansi', 'kg');
insert into public.products (id, product_name, unit_of_measurement, status, archived_at) values
  ('33333333-0000-0000-0000-000000000004', 'Old Mangoes', 'kg', 'archived', now() - interval '10 days');
insert into public.product_skus (id, product_id, selling_sku, unit_of_measurement) values
  ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'TOM-KG', 'kg'),
  ('44444444-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000002', 'CAB-HD', 'head'),
  ('44444444-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000003', 'CAL-KG', 'kg'),
  ('44444444-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000001', 'TOM-CR', 'crate');
insert into public.price_history (product_id, product_sku_id, cost_price, selling_price, effective_from, created_by) values
  ('33333333-0000-0000-0000-000000000001', null, 60, 85.55, now() - interval '60 days', '11111111-0000-0000-0000-000000000001'),
  ('33333333-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000004', 900, 1250, now() - interval '60 days', '11111111-0000-0000-0000-000000000001'),
  ('33333333-0000-0000-0000-000000000002', null, 70, 110, now() - interval '60 days', '11111111-0000-0000-0000-000000000001'),
  ('33333333-0000-0000-0000-000000000003', null, 40, 65.35, now() - interval '60 days', '11111111-0000-0000-0000-000000000001');
insert into public.customer_pricing (customer_id, product_id, selling_price, effective_from, created_by) values
  ('22222222-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 80.10, now() - interval '30 days', '11111111-0000-0000-0000-000000000001');
insert into public.inventory (sku_id, current_quantity, low_stock_threshold) values
  ('44444444-0000-0000-0000-000000000001', 42.5, 10), ('44444444-0000-0000-0000-000000000002', 3, 5);

-- Orders in every state. Fractional quantities make line rounding matter.
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date, created_at, requires_attention, attention_reason) values
  ('55555555-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'viber', '11111111-0000-0000-0000-000000000002', 'completed', current_date - 20, now() - interval '21 days', false, null),
  ('55555555-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'phone', '11111111-0000-0000-0000-000000000002', 'for_delivery', current_date, now() - interval '2 days', false, null),
  ('55555555-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001', 'messenger', '11111111-0000-0000-0000-000000000002', 'confirmed', current_date + 1, now() - interval '1 day', false, null),
  ('55555555-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000002', 'other', '11111111-0000-0000-0000-000000000002', 'for_verification', current_date + 2, now() - interval '3 hours', true, 'Check quantity'),
  ('55555555-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000003', 'purchase_order', '11111111-0000-0000-0000-000000000002', 'cancelled', current_date - 15, now() - interval '16 days', false, null),
  ('55555555-0000-0000-0000-000000000006', '22222222-0000-0000-0000-000000000001', 'phone', '11111111-0000-0000-0000-000000000002', 'for_preparation', current_date + 1, now() - interval '1 day', false, null);
insert into public.order_items (order_id, product_id, product_sku_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price, special_price, special_price_reason, special_price_authorized_by, special_price_authorized_at, preparation_status) values
  ('55555555-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', null, 0.333, 'kg', 80.10, 85.55, 60, 80.10, 'Customer price', '11111111-0000-0000-0000-000000000001', now() - interval '21 days', 'completed'),
  ('55555555-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000003', null, 1.257, 'kg', 65.35, 65.35, 40, null, null, null, null, 'completed'),
  ('55555555-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000004', null, 2.005, 'kg', 99.99, 99.99, 50, null, null, null, null, 'completed'),
  ('55555555-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000002', null, 3, 'head', 110, 110, 70, null, null, null, null, 'completed'),
  ('55555555-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000004', 0.5, 'crate', 1250, 1250, 900, null, null, null, null, 'completed'),
  ('55555555-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000003', null, 0.125, 'kg', 65.35, 65.35, 40, null, null, null, null, 'pending'),
  ('55555555-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000001', null, 1.111, 'kg', 85.55, 85.55, 60, null, null, null, null, 'pending'),
  ('55555555-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000002', null, 2, 'head', 110, 110, 70, null, null, null, null, 'pending'),
  ('55555555-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000001', null, 0.777, 'kg', 85.55, 85.55, 60, null, null, null, null, 'pending'),
  ('55555555-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000001', null, 0.333, 'kg', 85.55, 85.55, 60, null, null, null, null, 'completed'),
  ('55555555-0000-0000-0000-000000000006', '33333333-0000-0000-0000-000000000002', null, 1, 'head', 110, 110, 70, null, null, null, null, 'pending');
insert into public.deliveries (id, order_id, assigned_driver_id, scheduled_date, status, completed_at, received_by) values
  ('66666666-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000004', current_date - 20, 'completed', now() - interval '20 days', 'Maria Santos'),
  ('66666666-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000004', current_date, 'scheduled', null, null);
insert into public.order_activity (order_id, user_id, action, details) values
  ('55555555-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'order_created', '{}'),
  ('55555555-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'status_changed', '{"to":"cancelled"}');
insert into public.notifications (user_id, type, title, message, related_order_id, event_key) values
  ('11111111-0000-0000-0000-000000000001', 'order_created', 'New order', 'ORD-0004 needs checking', '55555555-0000-0000-0000-000000000004', 'legacy-1');
