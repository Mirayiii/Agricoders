-- MEAH product "Sold by" unit. Apply after 202609270002.
-- Product prices are product-level, so this is the unit a price and an order
-- line refer to (e.g. ₱85 per kg). It is free text rather than an enum so
-- staff can add units such as "box" or "bag" without a schema change; the
-- existing product_skus and order_items unit columns are already text.

alter table public.products add column unit_of_measurement text;

-- Existing products take the unit of their primary SKU (the first active
-- selling SKU, otherwise the first active SKU), matching what orders used.
update public.products p
set unit_of_measurement = s.unit_of_measurement
from (
  select distinct on (product_id) product_id, unit_of_measurement
  from public.product_skus
  where status = 'active'
  order by product_id, (selling_sku is null), created_at
) s
where s.product_id = p.id;

alter table public.products
  add constraint products_unit_of_measurement_length
  check (unit_of_measurement is null or char_length(trim(unit_of_measurement)) between 1 and 20);
