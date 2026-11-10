-- Jac, 4 Nov 2026: a stock tag (In stock, Low, Out of stock) shows only for a
-- product whose "Track inventory (stock)" switch is on. A product that is not
-- tracked has no stock count, so it must never read as "Out of stock".
--   * New order: get_product_inventory_availability returns rows for tracked
--     products only, so untracked products get no tag and no over-stock
--     warning. Still administrator only (SI-02, PS-02).
--   * To buy: stock on hand and "short of stock" are left out for untracked
--     products, and each line says whether its product is tracked.
-- Products & stock already showed stock for tracked products only.

create or replace function pg_temp.patch_function(p_function regprocedure, p_from text, p_to text)
returns void language plpgsql as $$
declare
  -- Line endings are ignored: a function created from a file checked out on
  -- Windows (CRLF) must patch the same as one created on Linux or macOS.
  v_def text := replace(pg_get_functiondef(p_function), E'\r', '');
  v_from text := replace(p_from, E'\r', '');
  v_count int := (length(v_def) - length(replace(v_def, v_from, ''))) / greatest(length(v_from), 1);
begin
  if v_count <> 1 then
    raise exception 'patch_function: expected 1 match in %, found % for: %', p_function, v_count, p_from;
  end if;
  execute replace(v_def, v_from, replace(p_to, E'\r', ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. New order stock tag: tracked products only
-- ---------------------------------------------------------------------------

create or replace function public.get_product_inventory_availability(p_product_ids uuid[])
returns table(product_id uuid, sku_id uuid, sku text, unit text, current_quantity numeric, status public.inventory_status)
language sql stable security definer set search_path = public as $$
  select ps.product_id, ps.id, coalesce(ps.selling_sku, ps.buying_sku), ps.unit_of_measurement,
    coalesce(i.current_quantity, 0), public.get_inventory_status(coalesce(i.current_quantity, 0), i.low_stock_threshold)
  from public.product_skus ps
  join public.products p on p.id = ps.product_id and p.track_stock
  left join public.inventory i on i.sku_id = ps.id
  where ps.product_id = any(p_product_ids) and ps.status = 'active'
    and public.is_active_administrator()
  order by ps.product_id, coalesce(ps.selling_sku, ps.buying_sku);
$$;
revoke all on function public.get_product_inventory_availability(uuid[]) from public;
grant execute on function public.get_product_inventory_availability(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. To buy: no stock figures for untracked products
-- ---------------------------------------------------------------------------

do $$ begin perform pg_temp.patch_function('public.get_buy_list(date, date)'::regprocedure,
  'where ps.status = ''active'' and v_admin',
  'where ps.status = ''active'' and v_admin
      and exists (select 1 from public.products tp where tp.id = ps.product_id and tp.track_stock)'); end $$;
do $$ begin perform pg_temp.patch_function('public.get_buy_list(date, date)'::regprocedure,
  'select d.*, p.product_name,',
  'select d.*, p.product_name, p.track_stock,'); end $$;
do $$ begin perform pg_temp.patch_function('public.get_buy_list(date, date)'::regprocedure,
  '''product_name'', product_name,',
  '''product_name'', product_name,
      ''track_stock'', track_stock,'); end $$;
