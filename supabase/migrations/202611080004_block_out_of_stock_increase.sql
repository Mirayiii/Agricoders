-- Jac, 8 Nov 2026 (15:24): a saved line whose unit has a recorded stock of 0
-- or less can keep or lower its quantity, but not raise it.
--   * Unchanged or lower quantity: allowed.
--   * Higher quantity: refused while the unit's recorded stock is 0 or less.
--     The server compares the new quantity with the saved one on the row.
--   * New lines, replaced products and changed units or SKUs: checked as
--     before (202611080002).
--   * No stock record, or Track inventory off: never blocked (202611080003).
-- This is only the out-of-stock rule: no reservation, no automatic stock
-- deduction, and no limit to the quantity on hand.

create or replace function public.order_items_block_out_of_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_same_line boolean;
begin
  if not public.is_app_call() then return new; end if;
  v_same_line := tg_op = 'UPDATE' and new.product_id = old.product_id
    and new.product_sku_id is not distinct from old.product_sku_id
    and new.unit_of_measurement = old.unit_of_measurement;
  -- A kept line may change its price or note, and keep or lower its quantity.
  if v_same_line and new.quantity <= old.quantity then
    return new;
  end if;
  if public.order_line_out_of_stock(new.product_id, new.product_sku_id, new.unit_of_measurement) then
    select product_name into v_name from public.products where id = new.product_id;
    if v_same_line then
      raise exception '% is out of stock, so its quantity can''t be raised above % %. Keep or lower it, or update the stock first.',
        coalesce(v_name, 'This product'), trim(to_char(old.quantity, 'FM999999990.###'), '.'), old.unit_of_measurement
        using errcode = 'P0001', hint = 'out_of_stock';
    end if;
    raise exception '% is out of stock. Remove it from the order, or update the stock first.', coalesce(v_name, 'This product')
      using errcode = 'P0001', hint = 'out_of_stock';
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_block_out_of_stock on public.order_items;
create trigger order_items_block_out_of_stock
  before insert or update of product_id, product_sku_id, unit_of_measurement, quantity on public.order_items
  for each row execute function public.order_items_block_out_of_stock();
