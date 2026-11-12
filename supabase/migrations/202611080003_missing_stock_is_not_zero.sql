-- Jac, 8 Nov 2026 (afternoon): a missing stock record is not the same as zero
-- stock.
--   * Only a stock record that says 0 or less makes a tracked unit
--     "Out of stock" and blocks adding it to an order.
--   * A tracked unit with no stock record reads as unknown ("Stock
--     unavailable") on Products & stock, New order and To buy. It is never
--     counted as 0, and it is not blocked.
--   * Turning on "Track inventory" (or adding a unit to a tracked product)
--     now stores an explicit stock record of 0 for each unit that has none,
--     with a history entry, so "starts at 0" is a recorded fact the app can
--     explain, not an assumption. Existing counts are never changed.
--   * Units that are already tracked without a record are left as they are
--     (shown as "Stock unavailable" until someone counts them), so nothing
--     silently becomes 0.

create or replace function pg_temp.patch_function(p_function regprocedure, p_from text, p_to text)
returns void language plpgsql as $$
declare
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
-- 1. The order rule: block only on a stock record of 0 or less
-- ---------------------------------------------------------------------------

create or replace function public.order_line_out_of_stock(p_product_id uuid, p_sku_id uuid, p_unit text)
returns boolean language sql stable security definer set search_path = public as $$
  with s as (select public.order_line_stock_sku(p_product_id, p_sku_id, p_unit) as sku_id)
  select exists (
    select 1 from s
    join public.products p on p.id = p_product_id and p.track_stock
    join public.product_skus ps on ps.id = s.sku_id and ps.status = 'active'
    join public.inventory i on i.sku_id = s.sku_id
    where i.current_quantity <= 0);
$$;
revoke all on function public.order_line_out_of_stock(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.get_out_of_stock_units(p_product_ids uuid[])
returns table(product_id uuid, sku_id uuid, unit text)
language sql stable security definer set search_path = public as $$
  select ps.product_id, ps.id, ps.unit_of_measurement
  from public.product_skus ps
  join public.products p on p.id = ps.product_id and p.track_stock and p.status = 'active'
  join public.inventory i on i.sku_id = ps.id
  where ps.product_id = any(p_product_ids) and ps.status = 'active'
    and i.current_quantity <= 0
    and public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]);
$$;
revoke all on function public.get_out_of_stock_units(uuid[]) from public, anon;
grant execute on function public.get_out_of_stock_units(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reads: no record = unknown (null), not 0
-- ---------------------------------------------------------------------------

do $$ begin perform pg_temp.patch_function('public.get_product_inventory_availability(uuid[])'::regprocedure,
  'coalesce(i.current_quantity, 0), public.get_inventory_status(coalesce(i.current_quantity, 0), i.low_stock_threshold)',
  'i.current_quantity, case when i.id is not null then public.get_inventory_status(i.current_quantity, i.low_stock_threshold) end'); end $$;

do $$ begin perform pg_temp.patch_function('public.get_products_overview()'::regprocedure,
  'case when p.track_stock then coalesce(i.current_quantity, 0) end, i.low_stock_threshold,
      case when p.track_stock then public.get_inventory_status(coalesce(i.current_quantity, 0), i.low_stock_threshold) end',
  'case when p.track_stock then i.current_quantity end, i.low_stock_threshold,
      case when p.track_stock and i.id is not null then public.get_inventory_status(i.current_quantity, i.low_stock_threshold) end'); end $$;

-- To buy: a unit's stock is known only when every active SKU counted in it has
-- a record. Otherwise stock, short_by and remaining stay null (unknown).
do $$ begin perform pg_temp.patch_function('public.get_buy_list(date, date)'::regprocedure,
  'sum(coalesce(inv.current_quantity, 0) * m.factor) as quantity',
  'case when bool_and(inv.id is not null) then sum(inv.current_quantity * m.factor) end as quantity'); end $$;

-- ---------------------------------------------------------------------------
-- 3. Turning tracking on stores an explicit 0
-- ---------------------------------------------------------------------------

create or replace function public.start_tracked_stock(p_product_id uuid, p_sku_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row record;
begin
  for v_row in
    insert into public.inventory(sku_id, current_quantity)
    select ps.id, 0 from public.product_skus ps
    where ps.product_id = p_product_id and ps.status = 'active'
      and (p_sku_id is null or ps.id = p_sku_id)
      and not exists (select 1 from public.inventory i where i.sku_id = ps.id)
    on conflict (sku_id) do nothing
    returning id, sku_id
  loop
    insert into public.inventory_transactions(inventory_id, sku_id, transaction_type, quantity, previous_quantity, new_quantity, reason, performed_by)
    values (v_row.id, v_row.sku_id, 'adjustment', 0, 0, 0, 'Stock tracking turned on: starts at 0 until counted', auth.uid());
  end loop;
end;
$$;
revoke all on function public.start_tracked_stock(uuid, uuid) from public, anon, authenticated;

-- App calls only, like the order rule: owner scripts and imports manage their
-- own stock records.
create or replace function public.products_start_tracked_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_call() then return new; end if;
  if tg_table_name = 'products' then
    if new.track_stock and (tg_op = 'INSERT' or not old.track_stock) then
      perform public.start_tracked_stock(new.id, null);
    end if;
  elsif new.status = 'active' and exists (select 1 from public.products p where p.id = new.product_id and p.track_stock) then
    perform public.start_tracked_stock(new.product_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists products_start_tracked_stock on public.products;
create trigger products_start_tracked_stock
  after insert or update of track_stock on public.products
  for each row execute function public.products_start_tracked_stock();

drop trigger if exists product_skus_start_tracked_stock on public.product_skus;
create trigger product_skus_start_tracked_stock
  after insert or update of status on public.product_skus
  for each row execute function public.products_start_tracked_stock();
