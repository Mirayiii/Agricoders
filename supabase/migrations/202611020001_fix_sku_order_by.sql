-- Fixes three report and stock functions whose ORDER BY named the output
-- column "sku". Inside a SQL function body that name is not visible, so
-- creating them fails with: column "sku" does not exist.
--
-- The two original migrations are corrected in place so a fresh database
-- builds. This migration re-creates the same three functions so a database
-- that already exists ends up with exactly the same definitions, whatever
-- state they are in there now. It only replaces functions: no table or row
-- is touched, and the results (columns and order) are unchanged.

create or replace function public.get_product_quantity_report(p_start date default null, p_end date default null, p_customer_id uuid default null, p_status public.order_status default null)
returns table(product_name text, sku text, quantity numeric, unit text)
language sql stable security definer set search_path = public as $$
  select p.product_name, coalesce(ps.selling_sku, ps.buying_sku, 'Base product'), sum(oi.quantity), oi.unit_of_measurement
  from public.orders o join public.order_items oi on oi.order_id = o.id join public.products p on p.id = oi.product_id left join public.product_skus ps on ps.id = oi.product_sku_id
  where public.can_read_order(o.id)
    and (p_start is null or o.requested_delivery_date >= p_start) and (p_end is null or o.requested_delivery_date <= p_end)
    and (p_customer_id is null or o.customer_id = p_customer_id) and (p_status is null or o.status = p_status)
  group by p.product_name, ps.selling_sku, ps.buying_sku, oi.unit_of_measurement
  order by p.product_name, coalesce(ps.selling_sku, ps.buying_sku, 'Base product');
$$;
revoke all on function public.get_product_quantity_report(date,date,uuid,public.order_status) from public;
grant execute on function public.get_product_quantity_report(date,date,uuid,public.order_status) to authenticated;

create or replace function public.get_inventory_list(p_search text default null, p_status public.inventory_status default null, p_limit integer default 25, p_offset integer default 0)
returns table(inventory_id uuid, sku_id uuid, product_name text, sku text, unit text, current_quantity numeric, low_stock_threshold numeric, status public.inventory_status, updated_at timestamptz, total_rows bigint)
language sql stable security definer set search_path = public as $$
  select i.id, ps.id, p.product_name, coalesce(ps.selling_sku, ps.buying_sku), ps.unit_of_measurement, coalesce(i.current_quantity, 0), i.low_stock_threshold, public.get_inventory_status(coalesce(i.current_quantity, 0), i.low_stock_threshold), i.updated_at, count(*) over()
  from public.product_skus ps join public.products p on p.id = ps.product_id left join public.inventory i on i.sku_id = ps.id
  where public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff', 'delivery_staff']::public.profile_role[])
    and ps.status = 'active' and p.status = 'active'
    and (p_search is null or p.product_name ilike '%' || p_search || '%' or coalesce(ps.selling_sku, ps.buying_sku) ilike '%' || p_search || '%')
    and (p_status is null or public.get_inventory_status(coalesce(i.current_quantity, 0), i.low_stock_threshold) = p_status)
  order by p.product_name, coalesce(ps.selling_sku, ps.buying_sku) limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.get_inventory_list(text, public.inventory_status, integer, integer) from public;
grant execute on function public.get_inventory_list(text, public.inventory_status, integer, integer) to authenticated;

create or replace function public.get_product_inventory_availability(p_product_ids uuid[])
returns table(product_id uuid, sku_id uuid, sku text, unit text, current_quantity numeric, status public.inventory_status)
language sql stable security definer set search_path = public as $$
  select ps.product_id, ps.id, coalesce(ps.selling_sku, ps.buying_sku), ps.unit_of_measurement,
    coalesce(i.current_quantity, 0), public.get_inventory_status(coalesce(i.current_quantity, 0), i.low_stock_threshold)
  from public.product_skus ps left join public.inventory i on i.sku_id = ps.id
  where ps.product_id = any(p_product_ids) and ps.status = 'active'
    and public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff', 'delivery_staff']::public.profile_role[])
  order by ps.product_id, coalesce(ps.selling_sku, ps.buying_sku);
$$;
revoke all on function public.get_product_inventory_availability(uuid[]) from public;
grant execute on function public.get_product_inventory_availability(uuid[]) to authenticated;
