-- Permissions from MEAH-Prototype 2.html, which Jac made the logic reference
-- on 5 Nov 2026 ("prototype wins" over the earlier requirements decisions):
--
--   * Products & stock is for the administrator, administrative staff and
--     purchasing staff. All three add and edit products, units and SKUs,
--     archive and restore them, and adjust stock.
--   * Prices (the Pricing tab, price history, batch prices and customer
--     prices) are for the administrator and administrative staff.
--   * Stock levels are read by the same three roles. Administrative staff see
--     In stock / Low / Out of stock again on New order.
--   * Administrative staff archive and restore customers too.
--   * Anyone who takes orders (administrator, administrative staff) may type a
--     different price on an order line. A reason is optional; without one the
--     line is saved with "Price changed on the order".
--
-- Functions are changed in place by exact text replacement, so each keeps its
-- body, grants and owner. Every replacement must match, otherwise the
-- migration stops.

create or replace function pg_temp.patch_all(p_function regprocedure, p_from text, p_to text, p_expected int default 1)
returns void language plpgsql as $$
declare
  v_def text := replace(pg_get_functiondef(p_function), E'\r', '');
  v_from text := replace(p_from, E'\r', '');
  v_count int := (length(v_def) - length(replace(v_def, v_from, ''))) / greatest(length(v_from), 1);
begin
  if v_count <> p_expected then
    raise exception 'patch_all: expected % match(es) in %, found % for: %', p_expected, p_function, v_count, p_from;
  end if;
  execute replace(v_def, v_from, replace(p_to, E'\r', ''));
end;
$$;

create or replace function public.can_manage_products()
returns boolean language sql stable set search_path = public as $$
  select public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]);
$$;
create or replace function public.can_manage_prices()
returns boolean language sql stable set search_path = public as $$
  select public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]);
$$;
revoke all on function public.can_manage_products() from public, anon;
revoke all on function public.can_manage_prices() from public, anon;
grant execute on function public.can_manage_products() to authenticated;
grant execute on function public.can_manage_prices() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Products, units, SKUs, archive: administrator, office and purchasing
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.create_product(jsonb, uuid)'::regprocedure,
    'public.update_product(uuid, jsonb, uuid)'::regprocedure,
    'public.set_product_archived(uuid, boolean, uuid)'::regprocedure
  ] loop
    perform pg_temp.patch_all(v_fn, 'public.is_active_administrator()', 'public.can_manage_products()');
    perform pg_temp.patch_all(v_fn, 'Only an administrator can change products, prices and stock', 'You do not have permission to change products');
  end loop;
end;
$$;

-- Prices: administrator and administrative staff.
do $$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.set_product_price(uuid, numeric, numeric, uuid)'::regprocedure,
    'public.batch_update_prices(date, jsonb, uuid)'::regprocedure,
    'public.get_batch_price_sheet(date, date)'::regprocedure,
    'public.get_price_history(uuid)'::regprocedure
  ] loop
    perform pg_temp.patch_all(v_fn, 'public.is_active_administrator()', 'public.can_manage_prices()');
    perform pg_temp.patch_all(v_fn, 'Only an administrator can change products, prices and stock', 'Only administrators and administrative staff can change prices');
  end loop;
end;
$$;

-- Products & stock list: the three roles. Cost and margin columns stay with
-- the roles that manage prices.
do $$ begin perform pg_temp.patch_all('public.get_products_overview()'::regprocedure,
  'v_prices boolean := public.is_active_administrator();', 'v_prices boolean := public.can_manage_prices();'); end $$;
do $$ begin perform pg_temp.patch_all('public.get_products_overview()'::regprocedure,
  '  if not public.is_active_administrator() then
    raise exception ''Only an administrator can open Products & stock'' using errcode = ''42501'';',
  '  if not public.can_manage_products() then
    raise exception ''You do not have permission to open Products & stock'' using errcode = ''42501'';'); end $$;

-- Stock: adjust and read.
do $$ begin perform pg_temp.patch_all('public.adjust_inventory(uuid, public.inventory_transaction_type, numeric, text, numeric)'::regprocedure,
  'public.is_active_administrator()', 'public.can_manage_products()'); end $$;
do $$ begin perform pg_temp.patch_all('public.adjust_inventory(uuid, public.inventory_transaction_type, numeric, text, numeric)'::regprocedure,
  'Only an administrator can adjust stock', 'You do not have permission to adjust stock'); end $$;
do $$ begin perform pg_temp.patch_all('public.get_inventory_list(text, public.inventory_status, integer, integer)'::regprocedure,
  'public.is_active_administrator()', 'public.can_manage_products()'); end $$;
do $$ begin perform pg_temp.patch_all('public.get_inventory_activity(uuid, integer)'::regprocedure,
  'public.is_active_administrator()', 'public.can_manage_products()'); end $$;
do $$ begin perform pg_temp.patch_all('public.get_product_inventory_availability(uuid[])'::regprocedure,
  'public.is_active_administrator()', 'public.can_manage_products()'); end $$;

-- Direct table access follows the same rules.
drop policy if exists "administrator_write_products" on public.products;
create policy "product_managers_write_products" on public.products for all to authenticated
  using (public.can_manage_products()) with check (public.can_manage_products());
drop policy if exists "administrator_write_skus" on public.product_skus;
create policy "product_managers_write_skus" on public.product_skus for all to authenticated
  using (public.can_manage_products()) with check (public.can_manage_products());
drop policy if exists "administrator_write_varieties" on public.product_varieties;
create policy "product_managers_write_varieties" on public.product_varieties for all to authenticated
  using (public.can_manage_products()) with check (public.can_manage_products());
drop policy if exists "administrator_insert_price_history" on public.price_history;
create policy "pricing_staff_insert_price_history" on public.price_history for insert to authenticated
  with check (public.can_manage_prices() and created_by = auth.uid());
drop policy if exists "administrator_write_customer_pricing" on public.customer_pricing;
create policy "pricing_staff_write_customer_pricing" on public.customer_pricing for all to authenticated
  using (public.can_manage_prices()) with check (public.can_manage_prices() and created_by = auth.uid());
drop policy if exists "administrator_read_inventory" on public.inventory;
create policy "product_managers_read_inventory" on public.inventory for select to authenticated
  using (public.can_manage_products());
drop policy if exists "administrator_read_inventory_transactions" on public.inventory_transactions;
create policy "product_managers_read_inventory_transactions" on public.inventory_transactions for select to authenticated
  using (public.can_manage_products());

-- ---------------------------------------------------------------------------
-- 2. Customers: administrator and administrative staff archive and restore
-- ---------------------------------------------------------------------------

do $$ begin perform pg_temp.patch_all('public.set_customer_archived(uuid, boolean, uuid)'::regprocedure,
  'public.is_active_administrator()', 'public.can_manage_prices()'); end $$;
do $$ begin perform pg_temp.patch_all('public.set_customer_archived(uuid, boolean, uuid)'::regprocedure,
  'Only an administrator can archive or restore customers', 'Only administrators and administrative staff can archive or restore customers'); end $$;
do $$ begin perform pg_temp.patch_all('public.customers_archive_by_administrator()'::regprocedure,
  'public.is_active_administrator()', 'public.can_manage_prices()'); end $$;
do $$ begin perform pg_temp.patch_all('public.customers_archive_by_administrator()'::regprocedure,
  'Only an administrator can archive or restore customers', 'Only administrators and administrative staff can archive or restore customers'); end $$;

-- ---------------------------------------------------------------------------
-- 3. A different price on an order line: anyone who takes orders
-- ---------------------------------------------------------------------------

do $$ begin perform pg_temp.patch_all('public.create_order_with_items(jsonb, jsonb)'::regprocedure,
  'v_special_reason := nullif(trim(v_item->>''special_price_reason''), '''');',
  'v_special_reason := case when v_special is not null then coalesce(nullif(trim(v_item->>''special_price_reason''), ''''), ''Price changed on the order'') end;'); end $$;
do $$ begin perform pg_temp.patch_all('public.create_order_with_items(jsonb, jsonb)'::regprocedure,
  'if not public.is_active_administrator() or v_special_reason is null or v_special < 0 then raise exception ''Special pricing requires an administrator and reason''; end if;',
  'if v_special < 0 then raise exception ''A price can''''t be below ₱0''; end if;'); end $$;
