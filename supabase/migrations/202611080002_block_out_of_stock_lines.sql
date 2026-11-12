-- Jac, 8 Nov 2026 (prototype rule): a product can't be added to an order
-- while "Track inventory" is on and its available stock is zero or below.
--   * Applies to every way a line is added: New order, Order again, offline
--     orders replayed later, and new lines in Edit order.
--   * Lines already saved are kept. Changing the quantity, price or note of an
--     existing line is allowed even when the product has run out since.
--     Changing a line to another unit adds a line, so the rule applies to it.
--   * Low stock is still allowed. Ordering more than the stock on hand is
--     still allowed with the existing warning.
--   * Untracked products are never blocked. Stock is counted per unit (SKU),
--     the same SKU the New order screen shows the tag for.
--   * A tracked unit with no stock record yet reads as 0 on Products & stock
--     and New order ("Out of stock"), so it is blocked too.
--
-- The rule runs on app calls only (is_app_call), so owner scripts, imports
-- and history are never refused.

-- The stock SKU behind an order line: its own SKU, or the product's active
-- SKU counted in the line's unit (a selling SKU first), as the app does.
create or replace function public.order_line_stock_sku(p_product_id uuid, p_sku_id uuid, p_unit text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(p_sku_id, (
    select ps.id from public.product_skus ps
    where ps.product_id = p_product_id and ps.status = 'active'
      and lower(trim(ps.unit_of_measurement)) = lower(trim(coalesce(p_unit, '')))
    order by (ps.selling_sku is not null) desc, ps.created_at, ps.id
    limit 1));
$$;
revoke all on function public.order_line_stock_sku(uuid, uuid, text) from public, anon, authenticated;

-- True only for a tracked product whose stock unit has none on hand.
create or replace function public.order_line_out_of_stock(p_product_id uuid, p_sku_id uuid, p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  with s as (select public.order_line_stock_sku(p_product_id, p_sku_id, p_unit) as sku_id)
  select exists (
    select 1 from s
    join public.products p on p.id = p_product_id and p.track_stock
    join public.product_skus ps on ps.id = s.sku_id and ps.status = 'active'
    left join public.inventory i on i.sku_id = s.sku_id
    where coalesce(i.current_quantity, 0) <= 0);
$$;
revoke all on function public.order_line_out_of_stock(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.order_items_block_out_of_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.is_app_call() then return new; end if;
  -- An existing line keeps its product and unit: quantity, price and note edits pass.
  if tg_op = 'UPDATE' and new.product_id = old.product_id
     and new.product_sku_id is not distinct from old.product_sku_id
     and new.unit_of_measurement = old.unit_of_measurement then
    return new;
  end if;
  if public.order_line_out_of_stock(new.product_id, new.product_sku_id, new.unit_of_measurement) then
    select product_name into v_name from public.products where id = new.product_id;
    raise exception '% is out of stock. Remove it from the order, or update the stock first.', coalesce(v_name, 'This product')
      using errcode = 'P0001', hint = 'out_of_stock';
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_block_out_of_stock on public.order_items;
create trigger order_items_block_out_of_stock
  before insert or update of product_id, product_sku_id, unit_of_measurement on public.order_items
  for each row execute function public.order_items_block_out_of_stock();

-- What the order screens need to grey out Add: the product and unit pairs that
-- are out of stock. Only staff who take orders may ask, and no quantities are
-- shown, so office staff learn only that a unit can't be ordered.
create or replace function public.get_out_of_stock_units(p_product_ids uuid[])
returns table(product_id uuid, sku_id uuid, unit text)
language sql stable security definer set search_path = public as $$
  select ps.product_id, ps.id, ps.unit_of_measurement
  from public.product_skus ps
  join public.products p on p.id = ps.product_id and p.track_stock and p.status = 'active'
  left join public.inventory i on i.sku_id = ps.id
  where ps.product_id = any(p_product_ids) and ps.status = 'active'
    and coalesce(i.current_quantity, 0) <= 0
    and public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]);
$$;
revoke all on function public.get_out_of_stock_units(uuid[]) from public, anon;
grant execute on function public.get_out_of_stock_units(uuid[]) to authenticated;
