-- Phase 8: Products & stock, and Reports.
--
-- Products
--   1. Optional stock tracking per product (track_stock).
--   2. Units without a SKU code, so a product can be sold by kg, piece or
--      sack before codes are given (the SKU codes stay unique when set).
--   3. Checks on every product write; products are archived, never deleted,
--      and an archived product can't go on an order saved after it was archived.
--   4. Product functions: list, save, units and codes, archive, one price,
--      and batch price updates that succeed or fail as a whole.
-- Reports (administrators only)
--   5. Sales report (overview, customers, products), customer statement, item
--      analytics and the daily price log.
--   6. The older report functions now refuse anyone but administrators.
--
-- Prices: a new price is a new price_history row; older rows stay, so past
-- prices are never changed. Orders keep the prices they were saved with.
-- Margin is (selling - cost) / selling, in the product's own unit. A cost of 0
-- means "no cost recorded": margins leave those out and say so.

-- ---------------------------------------------------------------------------
-- 1. Stock tracking
-- ---------------------------------------------------------------------------

alter table public.products add column if not exists track_stock boolean not null default false;

-- Products that already hold stock records keep showing stock.
update public.products p set track_stock = true
where exists (select 1 from public.product_skus ps join public.inventory i on i.sku_id = ps.id where ps.product_id = p.id);

-- ---------------------------------------------------------------------------
-- 2. Units without a SKU code
-- ---------------------------------------------------------------------------

alter table public.product_skus drop constraint if exists product_skus_reference_present;

-- Unit renames. Order lines, receipts and statements already keep the unit
-- text they were saved with (order_items.unit_of_measurement and the receipt
-- snapshot), so a rename never changes history. This log records each rename
-- so the old label of a unit can still be traced.
create table if not exists public.product_unit_renames (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  sku_id uuid not null references public.product_skus(id) on delete restrict,
  old_unit text not null,
  new_unit text not null,
  renamed_by uuid references public.profiles(id) on delete restrict,
  renamed_at timestamptz not null default now()
);
alter table public.product_unit_renames enable row level security;
create policy "management_read_unit_renames" on public.product_unit_renames for select to authenticated
  using (public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]));

-- ---------------------------------------------------------------------------
-- 3. Checks, archive instead of delete, no archived products on new orders
-- ---------------------------------------------------------------------------

create or replace function public.products_check_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.product_name := nullif(regexp_replace(trim(coalesce(new.product_name, '')), '\s+', ' ', 'g'), '');
  if new.product_name is null then raise exception 'Enter the product name' using errcode = '23514'; end if;
  new.unit_of_measurement := nullif(trim(coalesce(new.unit_of_measurement, '')), '');
  new.description := nullif(trim(coalesce(new.description, '')), '');
  if new.status = 'archived' then new.archived_at := coalesce(new.archived_at, now()); else new.archived_at := null; end if;
  return new;
end;
$$;
drop trigger if exists products_check_write on public.products;
create trigger products_check_write before insert or update on public.products
  for each row execute procedure public.products_check_write();

create or replace function public.products_block_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Products are archived, not deleted, so past orders keep their records.' using errcode = '42501';
end;
$$;
drop trigger if exists products_block_delete on public.products;
create trigger products_block_delete before delete on public.products
  for each row execute procedure public.products_block_delete();

-- A line for an archived product is refused on orders saved after the product
-- was archived. Orders saved before keep working, including edits to them.
create or replace function public.order_items_require_active_product()
returns trigger language plpgsql set search_path = public as $$
declare
  v_product public.products;
  v_order_created timestamptz;
begin
  if tg_op = 'UPDATE' and new.product_id is not distinct from old.product_id then return new; end if;
  select * into v_product from public.products where id = new.product_id for share;
  if v_product.status = 'archived' then
    select created_at into v_order_created from public.orders where id = new.order_id;
    if v_order_created >= v_product.archived_at then
      raise exception '% is archived, so it can''t be added to new orders.', v_product.product_name using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists order_items_require_active_product on public.order_items;
create trigger order_items_require_active_product before insert or update of product_id on public.order_items
  for each row execute procedure public.order_items_require_active_product();

-- ---------------------------------------------------------------------------
-- 4. Product functions
-- ---------------------------------------------------------------------------

-- Margin % on the selling price; null when there is no selling price or no
-- cost recorded (cost 0).
create or replace function public.margin_percent(p_cost numeric, p_selling numeric)
returns numeric language sql immutable as $$
  select case when coalesce(p_selling, 0) <= 0 or coalesce(p_cost, 0) <= 0 then null
    else round((p_selling - p_cost) / p_selling * 100, 1) end;
$$;
grant execute on function public.margin_percent(numeric, numeric) to authenticated;

-- The product-level price in force at a moment (orders use this one).
create or replace function public.product_price_at(p_product_id uuid, p_at timestamptz)
returns public.price_history language sql stable set search_path = public as $$
  select * from public.price_history
  where product_id = p_product_id and product_sku_id is null and effective_from <= p_at and (effective_to is null or effective_to > p_at)
  order by effective_from desc, created_at desc limit 1;
$$;
revoke all on function public.product_price_at(uuid, timestamptz) from public, anon, authenticated;

-- The SKU row for the product's default unit (where its codes and stock live).
create or replace function public.default_unit_sku(p_product_id uuid)
returns public.product_skus language sql stable set search_path = public as $$
  select ps.* from public.product_skus ps join public.products p on p.id = ps.product_id
  where ps.product_id = p_product_id and ps.status = 'active'
  order by (lower(ps.unit_of_measurement) = lower(coalesce(p.unit_of_measurement, ps.unit_of_measurement))) desc, (ps.selling_sku is null), ps.created_at
  limit 1;
$$;
revoke all on function public.default_unit_sku(uuid) from public, anon, authenticated;

-- Products & stock list. Prices are shown to administrators and
-- administrative staff only, as before.
create or replace function public.get_products_overview()
returns table(
  id uuid, product_name text, status public.record_status, unit text, track_stock boolean, unit_count integer,
  buying_sku text, selling_sku text, sku_id uuid,
  cost_price numeric, selling_price numeric, margin_percent numeric,
  stock_quantity numeric, low_stock_threshold numeric, stock_status public.inventory_status
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_prices boolean := public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]);
begin
  -- Every staff role could see stock levels before (Inventory); prices stay
  -- with administrators and administrative staff.
  if not public.is_active_account() then
    raise exception 'You do not have permission to view products' using errcode = '42501';
  end if;
  return query
    select p.id, p.product_name, p.status, coalesce(p.unit_of_measurement, d.unit_of_measurement), p.track_stock,
      (select count(*)::int from public.product_skus s where s.product_id = p.id and s.status = 'active'),
      d.buying_sku, d.selling_sku, d.id,
      case when v_prices then pr.cost_price end, case when v_prices then pr.selling_price end,
      case when v_prices then public.margin_percent(pr.cost_price, pr.selling_price) end,
      case when p.track_stock then coalesce(i.current_quantity, 0) end, i.low_stock_threshold,
      case when p.track_stock then public.get_inventory_status(coalesce(i.current_quantity, 0), i.low_stock_threshold) end
    from public.products p
    left join lateral public.default_unit_sku(p.id) d on true
    left join lateral public.product_price_at(p.id, now()) pr on true
    left join public.inventory i on i.sku_id = d.id
    order by lower(p.product_name);
end;
$$;
revoke all on function public.get_products_overview() from public, anon;
grant execute on function public.get_products_overview() to authenticated;

-- Raises a readable message for a SKU code already in use.
create or replace function public.check_sku_code(p_code text, p_kind text, p_except uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_name text;
begin
  if p_code is null then return; end if;
  select p.product_name into v_name from public.product_skus s join public.products p on p.id = s.product_id
  where s.id is distinct from p_except and (case when p_kind = 'buying' then s.buying_sku else s.selling_sku end) = p_code limit 1;
  if v_name is not null then raise exception '% SKU % is already used by %', initcap(p_kind), p_code, v_name; end if;
end;
$$;
revoke all on function public.check_sku_code(text, text, uuid) from public, anon, authenticated;

-- Add product (Figma): name, units sold by (first is the default), track
-- stock, cost and selling price, buying and selling SKU. One transaction.
create or replace function public.create_product(p_product jsonb, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_replay jsonb;
  v_product public.products;
  v_units text[];
  v_unit text;
  v_default_sku uuid;
  v_cost numeric := nullif(p_product->>'cost_price', '')::numeric;
  v_selling numeric := nullif(p_product->>'selling_price', '')::numeric;
  v_buying text := nullif(upper(trim(coalesce(p_product->>'buying_sku', ''))), '');
  v_sell_code text := nullif(upper(trim(coalesce(p_product->>'selling_sku', ''))), '');
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can change products and prices' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('create_product', p_client_request_id, p_product);
  if v_replay is not null then return v_replay; end if;

  select array_agg(distinct u order by u) filter (where u <> '') into v_units
    from (select trim(x) as u from jsonb_array_elements_text(coalesce(p_product->'units', '[]'::jsonb)) x) t;
  v_unit := nullif(trim(coalesce(p_product->>'default_unit', '')), '');
  if v_unit is null and v_units is not null then v_unit := v_units[1]; end if;
  if v_unit is null then raise exception 'Choose at least one unit the product is sold by'; end if;
  if char_length(v_unit) > 20 then raise exception 'Unit names can be at most 20 characters'; end if;
  if exists (select 1 from public.products where lower(product_name) = lower(regexp_replace(trim(coalesce(p_product->>'product_name', '')), '\s+', ' ', 'g'))) then
    raise exception 'A product named % already exists', trim(p_product->>'product_name');
  end if;
  if (v_cost is null) <> (v_selling is null) then raise exception 'Enter both the cost and the selling price, or neither'; end if;
  if v_selling is not null and v_selling <= 0 then raise exception 'The selling price must be more than ₱0'; end if;
  if v_cost is not null and v_cost < 0 then raise exception 'The cost can''t be negative'; end if;
  perform public.check_sku_code(v_buying, 'buying', null);
  perform public.check_sku_code(v_sell_code, 'selling', null);

  insert into public.products (product_name, description, unit_of_measurement, track_stock)
  values (p_product->>'product_name', p_product->>'description', v_unit, coalesce((p_product->>'track_stock')::boolean, false))
  returning * into v_product;

  insert into public.product_skus (product_id, buying_sku, selling_sku, unit_of_measurement)
  values (v_product.id, v_buying, v_sell_code, v_unit) returning id into v_default_sku;
  insert into public.product_skus (product_id, unit_of_measurement)
  select v_product.id, u from unnest(coalesce(v_units, '{}')) u where lower(u) <> lower(v_unit);

  if v_selling is not null then
    insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by, created_at)
    values (v_product.id, round(v_cost, 2), round(v_selling, 2), now(), auth.uid(), clock_timestamp());
  end if;

  v_result := jsonb_build_object('product_id', v_product.id, 'product_name', v_product.product_name);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.create_product(jsonb, uuid) from public, anon;
grant execute on function public.create_product(jsonb, uuid) to authenticated;

-- Details tab: name, stock tracking, units (default, add, remove) and the
-- default unit's buying and selling SKU. Only the keys sent are changed.
create or replace function public.update_product(p_product_id uuid, p_changes jsonb, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_replay jsonb;
  v_product public.products;
  v_sku public.product_skus;
  v_unit text;
  v_code text;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can change products and prices' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('update_product', p_client_request_id, jsonb_build_object('product_id', p_product_id, 'changes', p_changes));
  if v_replay is not null then return v_replay; end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;

  if p_changes ? 'product_name' then
    if exists (select 1 from public.products where id <> p_product_id and lower(product_name) = lower(regexp_replace(trim(coalesce(p_changes->>'product_name', '')), '\s+', ' ', 'g'))) then
      raise exception 'A product named % already exists', trim(p_changes->>'product_name');
    end if;
    update public.products set product_name = p_changes->>'product_name' where id = p_product_id;
  end if;
  if p_changes ? 'track_stock' then
    update public.products set track_stock = (p_changes->>'track_stock')::boolean where id = p_product_id;
  end if;

  if p_changes ? 'add_unit' then
    v_unit := nullif(regexp_replace(trim(coalesce(p_changes->>'add_unit', '')), '\s+', ' ', 'g'), '');
    if v_unit is null then raise exception 'Enter a unit'; end if;
    if char_length(v_unit) > 20 then raise exception 'Unit names can be at most 20 characters'; end if;
    if exists (select 1 from public.product_skus where product_id = p_product_id and status = 'active' and lower(unit_of_measurement) = lower(v_unit)) then
      raise exception '% is already one of this product''s units', v_unit;
    end if;
    insert into public.product_skus (product_id, unit_of_measurement) values (p_product_id, v_unit);
  end if;

  -- Rename a unit. Past orders keep the unit text they were saved with. A
  -- unit that carries meaning (stock on hand, the product's prices, or
  -- customer special prices) may only get a new spelling of the same measure
  -- (kg to kilo, pc to piece), so counts and prices keep their meaning.
  if p_changes ? 'rename_unit' then
    declare
      v_from text := trim(p_changes->'rename_unit'->>'from');
      v_to text := nullif(regexp_replace(trim(coalesce(p_changes->'rename_unit'->>'to', '')), '\s+', ' ', 'g'), '');
      v_same boolean;
      v_meaning text;
    begin
      select * into v_sku from public.product_skus where product_id = p_product_id and status = 'active' and lower(unit_of_measurement) = lower(v_from) for update;
      if not found then raise exception '% is not one of this product''s units', v_from; end if;
      if v_to is null then raise exception 'Enter the new unit name'; end if;
      if char_length(v_to) > 20 then raise exception 'Unit names can be at most 20 characters'; end if;
      if v_to = v_sku.unit_of_measurement then raise exception 'That is already the unit''s name'; end if;
      if exists (select 1 from public.product_skus where product_id = p_product_id and status = 'active' and id <> v_sku.id and lower(unit_of_measurement) = lower(v_to)) then
        raise exception '% is already one of this product''s units', v_to;
      end if;
      select (a.unit_key, a.factor) = (b.unit_key, b.factor) into v_same
      from public.unit_measure(v_sku.unit_of_measurement) a, public.unit_measure(v_to) b;
      v_meaning := case
        when exists (select 1 from public.inventory where sku_id = v_sku.id and current_quantity > 0) then 'stock on hand'
        when lower(v_sku.unit_of_measurement) = lower(coalesce(v_product.unit_of_measurement, '')) and exists (select 1 from public.price_history where product_id = p_product_id and product_sku_id is null) then 'prices'
        when exists (select 1 from public.price_history where product_sku_id = v_sku.id) then 'prices'
        when exists (select 1 from public.customer_pricing where product_sku_id = v_sku.id) then 'customer special prices'
      end;
      if v_meaning is not null and not v_same then
        raise exception '% has %, so it can only be respelled as the same measure (for example kg to kilo). Add % as a new unit instead.', v_sku.unit_of_measurement, v_meaning, v_to;
      end if;
      update public.product_skus set unit_of_measurement = v_to where id = v_sku.id;
      if lower(v_sku.unit_of_measurement) = lower(coalesce(v_product.unit_of_measurement, '')) then
        update public.products set unit_of_measurement = v_to where id = p_product_id;
      end if;
      insert into public.product_unit_renames (product_id, sku_id, old_unit, new_unit, renamed_by)
      values (p_product_id, v_sku.id, v_sku.unit_of_measurement, v_to, auth.uid());
      select * into v_product from public.products where id = p_product_id;
    end;
  end if;

  if p_changes ? 'default_unit' then
    v_unit := trim(p_changes->>'default_unit');
    if not exists (select 1 from public.product_skus where product_id = p_product_id and status = 'active' and lower(unit_of_measurement) = lower(v_unit)) then
      raise exception '% is not one of this product''s units', v_unit;
    end if;
    -- Prices are per default unit, so a price in kg can't silently become a
    -- price per piece: a different unit needs its own cost and selling price,
    -- saved in the same step. Past prices and orders keep their unit.
    if lower(v_unit) <> lower(coalesce(v_product.unit_of_measurement, '')) then
      if exists (select 1 from public.price_history where product_id = p_product_id and product_sku_id is null and effective_from > now()) then
        raise exception 'A later price is scheduled per %. Wait until it applies before changing the default unit.', v_product.unit_of_measurement;
      end if;
      if (public.product_price_at(p_product_id, now())).id is not null then
        if not (p_changes ? 'selling_price') then
          raise exception 'Prices are set per %. Enter the cost and selling price per % to make it the default unit.', v_product.unit_of_measurement, v_unit
            using hint = 'price_needed';
        end if;
        perform public.check_price_row(v_product, (p_changes->>'cost_price')::numeric, (p_changes->>'selling_price')::numeric);
        insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by, created_at)
        values (p_product_id, round((p_changes->>'cost_price')::numeric, 2), round((p_changes->>'selling_price')::numeric, 2), now(), auth.uid(), clock_timestamp());
      end if;
    end if;
    update public.products set unit_of_measurement = (select unit_of_measurement from public.product_skus where product_id = p_product_id and status = 'active' and lower(unit_of_measurement) = lower(v_unit) limit 1)
    where id = p_product_id;
  end if;

  if p_changes ? 'remove_unit' then
    v_unit := trim(p_changes->>'remove_unit');
    select * into v_product from public.products where id = p_product_id;
    if lower(v_unit) = lower(coalesce(v_product.unit_of_measurement, '')) then
      raise exception 'The default unit can''t be removed. Set another unit as default first.';
    end if;
    select * into v_sku from public.product_skus where product_id = p_product_id and status = 'active' and lower(unit_of_measurement) = lower(v_unit) for update;
    if not found then raise exception '% is not one of this product''s units', v_unit; end if;
    if exists (select 1 from public.inventory where sku_id = v_sku.id and current_quantity > 0) then
      raise exception 'There is still % in stock. Remove that stock first.', v_unit;
    end if;
    -- Kept, not deleted: past orders and stock history refer to it.
    update public.product_skus set status = 'archived' where id = v_sku.id;
  end if;

  if p_changes ? 'buying_sku' or p_changes ? 'selling_sku' then
    v_sku := public.default_unit_sku(p_product_id);
    if v_sku.id is null then raise exception 'This product has no unit to attach a SKU to'; end if;
    if p_changes ? 'buying_sku' then
      v_code := nullif(upper(trim(coalesce(p_changes->>'buying_sku', ''))), '');
      perform public.check_sku_code(v_code, 'buying', v_sku.id);
      update public.product_skus set buying_sku = v_code where id = v_sku.id;
    end if;
    if p_changes ? 'selling_sku' then
      v_code := nullif(upper(trim(coalesce(p_changes->>'selling_sku', ''))), '');
      perform public.check_sku_code(v_code, 'selling', v_sku.id);
      update public.product_skus set selling_sku = v_code where id = v_sku.id;
    end if;
  end if;

  select * into v_product from public.products where id = p_product_id;
  v_result := jsonb_build_object('product_id', v_product.id, 'product_name', v_product.product_name);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.update_product(uuid, jsonb, uuid) from public, anon;
grant execute on function public.update_product(uuid, jsonb, uuid) to authenticated;

create or replace function public.set_product_archived(p_product_id uuid, p_archived boolean, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_replay jsonb;
  v_row public.products;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can change products and prices' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('set_product_archived', p_client_request_id, jsonb_build_object('product_id', p_product_id, 'archived', p_archived));
  if v_replay is not null then return v_replay; end if;
  select * into v_row from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if v_row.status <> (case when p_archived then 'archived' else 'active' end)::public.record_status then
    update public.products set status = case when p_archived then 'archived' else 'active' end::public.record_status, archived_at = null
    where id = p_product_id returning * into v_row;
  end if;
  v_result := jsonb_build_object('product_id', v_row.id, 'product_name', v_row.product_name, 'status', v_row.status);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.set_product_archived(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_product_archived(uuid, boolean, uuid) to authenticated;

-- One row of new prices, checked. Raises with the product's name.
create or replace function public.check_price_row(p_product public.products, p_cost numeric, p_selling numeric)
returns void language plpgsql immutable as $$
begin
  if p_product.id is null then raise exception 'A product in the list no longer exists'; end if;
  if p_product.status = 'archived' then raise exception '%: archived products can''t be priced', p_product.product_name; end if;
  if p_selling is null or p_cost is null then raise exception '%: enter both the cost and the selling price', p_product.product_name; end if;
  if p_selling <= 0 then raise exception '%: the selling price must be more than ₱0', p_product.product_name; end if;
  if p_cost < 0 then raise exception '%: the cost can''t be negative', p_product.product_name; end if;
  if p_selling > 9999999 or p_cost > 9999999 then raise exception '%: that price is too large', p_product.product_name; end if;
end;
$$;
revoke all on function public.check_price_row(public.products, numeric, numeric) from public, anon, authenticated;

-- Update price (one product): applies to orders saved from now on.
create or replace function public.set_product_price(p_product_id uuid, p_cost numeric, p_selling numeric, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_replay jsonb;
  v_product public.products;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can change products and prices' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('set_product_price', p_client_request_id, jsonb_build_object('product_id', p_product_id, 'cost', p_cost, 'selling', p_selling));
  if v_replay is not null then return v_replay; end if;
  select * into v_product from public.products where id = p_product_id for update;
  perform public.check_price_row(v_product, p_cost, p_selling);
  insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by, created_at)
  values (p_product_id, round(p_cost, 2), round(p_selling, 2), now(), auth.uid(), clock_timestamp());
  v_result := jsonb_build_object('product_id', p_product_id, 'cost_price', round(p_cost, 2), 'selling_price', round(p_selling, 2),
    'margin_percent', public.margin_percent(p_cost, p_selling));
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.set_product_price(uuid, numeric, numeric, uuid) from public, anon;
grant execute on function public.set_product_price(uuid, numeric, numeric, uuid) to authenticated;

-- Daily price batch update: every row or none. A price date of today takes
-- effect now; a later date takes effect at the start of that day in Manila.
-- Past dates are refused so history is never rewritten. Saving again for the
-- same future date replaces that date's not-yet-used prices.
create or replace function public.batch_update_prices(p_price_date date, p_rows jsonb, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_replay jsonb;
  v_from timestamptz;
  v_row jsonb;
  v_product public.products;
  v_cost numeric;
  v_selling numeric;
  v_count int := 0;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can change products and prices' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('batch_update_prices', p_client_request_id, jsonb_build_object('date', p_price_date, 'rows', p_rows));
  if v_replay is not null then return v_replay; end if;
  if p_price_date is null then raise exception 'Choose the price date'; end if;
  if p_price_date < public.manila_today() then raise exception 'Prices can''t be backdated. Choose today or a later date.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'There are no price changes to save'; end if;
  if (select count(*) from jsonb_array_elements(p_rows) r) <> (select count(distinct r->>'product_id') from jsonb_array_elements(p_rows) r) then
    raise exception 'A product is listed twice';
  end if;
  v_from := case when p_price_date = public.manila_today() then now() else (p_price_date::timestamp at time zone 'Asia/Manila') end;

  for v_row in select * from jsonb_array_elements(p_rows) order by value->>'product_id' loop
    select * into v_product from public.products where id = nullif(v_row->>'product_id', '')::uuid for update;
    v_cost := nullif(v_row->>'cost_price', '')::numeric;
    v_selling := nullif(v_row->>'selling_price', '')::numeric;
    perform public.check_price_row(v_product, v_cost, v_selling);
    if p_price_date > public.manila_today() and exists (select 1 from public.price_history where product_id = v_product.id and product_sku_id is null and effective_from = v_from) then
      update public.price_history set cost_price = round(v_cost, 2), selling_price = round(v_selling, 2), created_by = auth.uid(), created_at = clock_timestamp()
      where product_id = v_product.id and product_sku_id is null and effective_from = v_from;
    else
      insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by, created_at)
      values (v_product.id, round(v_cost, 2), round(v_selling, 2), v_from, auth.uid(), clock_timestamp());
    end if;
    v_count := v_count + 1;
  end loop;

  v_result := jsonb_build_object('price_date', p_price_date, 'updated', v_count, 'effective_from', v_from);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.batch_update_prices(date, jsonb, uuid) from public, anon;
grant execute on function public.batch_update_prices(date, jsonb, uuid) to authenticated;

-- Product detail · Pricing: every product-level price, newest first, with who set it.
create or replace function public.get_price_history(p_product_id uuid)
returns table(id uuid, cost_price numeric, selling_price numeric, margin_percent numeric, effective_from timestamptz, price_date date, set_by text, is_current boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_current uuid;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can change products and prices' using errcode = '42501';
  end if;
  v_current := (public.product_price_at(p_product_id, now())).id;
  return query
    select ph.id, ph.cost_price, ph.selling_price, public.margin_percent(ph.cost_price, ph.selling_price), ph.effective_from,
      (ph.effective_from at time zone 'Asia/Manila')::date, coalesce(pr.full_name, pr.email), ph.id = v_current
    from public.price_history ph left join public.profiles pr on pr.id = ph.created_by
    where ph.product_id = p_product_id and ph.product_sku_id is null
    order by ph.effective_from desc, ph.created_at desc
    limit 100;
end;
$$;
revoke all on function public.get_price_history(uuid) from public, anon;
grant execute on function public.get_price_history(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reports (administrators only)
-- ---------------------------------------------------------------------------
-- Sales count orders that are Confirmed, Preparing, For delivery or
-- Completed, by delivery date (Manila). Order totals are net of discounts
-- (Phase 3). Each line's share of a discount follows its share of the order.
-- Volume adds up only compatible units (kg with g, l with ml, pieces with
-- dozens); every other unit is listed on its own.

create or replace function public.report_lines(p_start date, p_end date)
returns table(
  order_id uuid, order_number text, order_status public.order_status, delivery_date date, customer_id uuid,
  product_id uuid, product_name text, unit text, unit_key text, volume numeric, quantity numeric,
  sales numeric, cost numeric, has_cost boolean
)
language sql stable security definer set search_path = public as $$
  with o as (
    select o.*, public.order_total(o) as total, public.order_subtotal(o) as subtotal
    from public.orders o
    where o.status in ('confirmed', 'for_preparation', 'for_delivery', 'completed')
      and (p_start is null or o.requested_delivery_date >= p_start)
      and (p_end is null or o.requested_delivery_date <= p_end)
  )
  select o.id, o.order_number, o.status, o.requested_delivery_date, o.customer_id,
    oi.product_id, p.product_name, oi.unit_of_measurement, u.unit_key, oi.quantity * u.factor, oi.quantity,
    round(coalesce(oi.line_total, oi.quantity * oi.unit_price) * case when o.subtotal > 0 then o.total / o.subtotal else 0 end, 2),
    round(oi.quantity * oi.cost_price, 2), oi.cost_price > 0
  from o
  join public.order_items oi on oi.order_id = o.id
  join public.products p on p.id = oi.product_id
  cross join lateral public.unit_measure(oi.unit_of_measurement) u;
$$;
revoke all on function public.report_lines(date, date) from public, anon, authenticated;

-- Totals for a set of lines, as jsonb.
create or replace function public.report_totals(p_lines jsonb)
returns jsonb language sql immutable as $$
  with l as (select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as x(order_id uuid, unit_key text, volume numeric, sales numeric, cost numeric, has_cost boolean))
  select jsonb_build_object(
    'sales', coalesce(sum(sales), 0),
    'orders', count(distinct order_id),
    'covered_sales', coalesce(sum(sales) filter (where has_cost), 0),
    'cost', coalesce(sum(cost) filter (where has_cost), 0),
    'profit', coalesce(sum(sales - cost) filter (where has_cost), 0),
    'margin_percent', case when coalesce(sum(sales) filter (where has_cost), 0) > 0
      then round(sum(sales - cost) filter (where has_cost) / sum(sales) filter (where has_cost) * 100, 1) end,
    'lines_without_cost', count(*) filter (where not has_cost),
    'volume', coalesce((select jsonb_agg(jsonb_build_object('unit', unit_key, 'quantity', q) order by q desc)
      from (select unit_key, sum(volume) as q from l group by unit_key) v), '[]'::jsonb)
  ) from l;
$$;
revoke all on function public.report_totals(jsonb) from public, anon, authenticated;

-- Overview, Customer report and Product volume report for one period.
create or replace function public.get_sales_report(p_start date, p_end date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_lines jsonb;
  v_result jsonb;
begin
  if not public.is_active_administrator() then
    raise exception 'Reports are available to administrators only' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_lines from public.report_lines(p_start, p_end) l;

  select jsonb_build_object(
    'start', p_start, 'end', p_end,
    'totals', public.report_totals(v_lines),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'sales', coalesce(s.sales, 0), 'volume', coalesce(s.volume, 0)) order by d)
      from generate_series(p_start, p_end, interval '1 day') d
      left join (select (x->>'delivery_date')::date as day, sum((x->>'sales')::numeric) as sales,
                   sum((x->>'volume')::numeric) filter (where x->>'unit_key' = 'kg') as volume
                 from jsonb_array_elements(v_lines) x group by 1) s on s.day = d::date
      where p_start is not null and p_end is not null and p_end - p_start <= 400
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(c order by (c->>'sales')::numeric desc, c->>'name')
      from (
        select jsonb_build_object('customer_id', cu.id, 'name', coalesce(cu.brand_name, cu.business_name), 'code', cu.customer_code, 'status', cu.status)
          || public.report_totals((select jsonb_agg(x) from jsonb_array_elements(v_lines) x where (x->>'customer_id')::uuid = cu.id)) as c
        from public.customers cu
        where cu.status = 'active' or exists (select 1 from jsonb_array_elements(v_lines) x where (x->>'customer_id')::uuid = cu.id)
      ) t
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(p order by (p->>'main_volume')::numeric desc nulls last, p->>'name')
      from (
        select jsonb_build_object('product_id', pr.id, 'name', pr.product_name, 'unit', pr.unit_of_measurement,
            'clients', (select count(distinct x->>'customer_id') from jsonb_array_elements(v_lines) x where (x->>'product_id')::uuid = pr.id),
            'main_volume', (select coalesce(sum((x->>'volume')::numeric), 0) from jsonb_array_elements(v_lines) x
                            where (x->>'product_id')::uuid = pr.id and x->>'unit_key' = (select unit_key from public.unit_measure(pr.unit_of_measurement))))
          || public.report_totals((select jsonb_agg(x) from jsonb_array_elements(v_lines) x where (x->>'product_id')::uuid = pr.id)) as p
        from public.products pr
        where pr.status = 'active' or exists (select 1 from jsonb_array_elements(v_lines) x where (x->>'product_id')::uuid = pr.id)
      ) t
    ), '[]'::jsonb),
    'active_customers', (select count(*) from public.customers where status = 'active'),
    'products_total', (select count(*) from public.products where status = 'active')
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_sales_report(date, date) from public, anon;
grant execute on function public.get_sales_report(date, date) to authenticated;

-- Customer analytics and the customer statement: one
-- customer's totals, daily sales and every order in the period with its
-- lines. Unlike sales totals, the statement lists every order that isn't
-- cancelled, with its status, so nothing billed is missing.
create or replace function public.get_customer_statement(p_customer_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_customer public.customers;
  v_lines jsonb;
begin
  if not public.is_active_administrator() then
    raise exception 'Reports are available to administrators only' using errcode = '42501';
  end if;
  select * into v_customer from public.customers where id = p_customer_id;
  if not found then raise exception 'Customer not found'; end if;
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_lines from public.report_lines(p_start, p_end) l where l.customer_id = p_customer_id;

  return jsonb_build_object(
    'customer', jsonb_build_object('id', v_customer.id, 'name', coalesce(v_customer.brand_name, v_customer.business_name),
      'business_name', v_customer.business_name, 'brand_name', v_customer.brand_name, 'tin', v_customer.tin, 'code', v_customer.customer_code,
      'contact_person', v_customer.contact_person, 'phone', v_customer.phone, 'delivery_address', v_customer.delivery_address),
    'start', p_start, 'end', p_end,
    'totals', public.report_totals(v_lines),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'sales', coalesce(s.sales, 0), 'volume', coalesce(s.volume, 0)) order by d)
      from generate_series(p_start, p_end, interval '1 day') d
      left join (select (x->>'delivery_date')::date as day, sum((x->>'sales')::numeric) as sales,
                   sum((x->>'volume')::numeric) filter (where x->>'unit_key' = 'kg') as volume
                 from jsonb_array_elements(v_lines) x group by 1) s on s.day = d::date
      where p_start is not null and p_end is not null and p_end - p_start <= 400
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
          'order_id', o.id, 'order_number', o.order_number, 'status', o.status, 'delivery_date', o.requested_delivery_date,
          'dr_number', r.dr_number, 'sales_invoice_number', o.sales_invoice_number,
          'received_by', d.received_by,
          'subtotal', public.order_subtotal(o), 'discount', public.order_discount(o), 'total', public.order_total(o),
          'lines', (select coalesce(jsonb_agg(jsonb_build_object('product_name', p.product_name, 'quantity', oi.quantity, 'unit', oi.unit_of_measurement,
                      'unit_price', oi.unit_price, 'amount', coalesce(oi.line_total, round(oi.quantity * oi.unit_price, 2))) order by oi.created_at, p.product_name), '[]'::jsonb)
                    from public.order_items oi join public.products p on p.id = oi.product_id where oi.order_id = o.id)
        ) order by o.requested_delivery_date desc, o.order_number desc)
      from public.orders o
      left join public.delivery_receipts r on r.order_id = o.id
      left join lateral (select received_by from public.deliveries dd where dd.order_id = o.id and dd.status = 'completed' order by dd.completed_at desc limit 1) d on true
      where o.customer_id = p_customer_id and o.status <> 'cancelled'
        and (p_start is null or o.requested_delivery_date >= p_start)
        and (p_end is null or o.requested_delivery_date <= p_end)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_customer_statement(uuid, date, date) from public, anon;
grant execute on function public.get_customer_statement(uuid, date, date) to authenticated;

-- Item analytics: one product's totals, daily volume and its customers.
create or replace function public.get_item_analytics(p_product_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_product public.products;
  v_price public.price_history;
  v_lines jsonb;
  v_key text;
begin
  if not public.is_active_administrator() then
    raise exception 'Reports are available to administrators only' using errcode = '42501';
  end if;
  select * into v_product from public.products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  v_price := public.product_price_at(p_product_id, now());
  v_key := (select unit_key from public.unit_measure(v_product.unit_of_measurement));
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_lines from public.report_lines(p_start, p_end) l where l.product_id = p_product_id;
  return jsonb_build_object(
    'product', jsonb_build_object('id', v_product.id, 'name', v_product.product_name, 'unit', v_product.unit_of_measurement, 'unit_key', v_key,
      'selling_sku', (public.default_unit_sku(p_product_id)).selling_sku, 'buying_sku', (public.default_unit_sku(p_product_id)).buying_sku,
      'selling_price', v_price.selling_price, 'cost_price', v_price.cost_price),
    'start', p_start, 'end', p_end,
    'totals', public.report_totals(v_lines),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', d, 'volume', coalesce(s.volume, 0), 'sales', coalesce(s.sales, 0)) order by d)
      from generate_series(p_start, p_end, interval '1 day') d
      left join (select (x->>'delivery_date')::date as day, sum((x->>'volume')::numeric) filter (where x->>'unit_key' = v_key) as volume, sum((x->>'sales')::numeric) as sales
                 from jsonb_array_elements(v_lines) x group by 1) s on s.day = d::date
      where p_start is not null and p_end is not null and p_end - p_start <= 400
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(c order by (c->>'main_volume')::numeric desc, c->>'name')
      from (
        select jsonb_build_object('customer_id', cu.id, 'name', coalesce(cu.brand_name, cu.business_name),
            'main_volume', (select coalesce(sum((x->>'volume')::numeric), 0) from jsonb_array_elements(v_lines) x where (x->>'customer_id')::uuid = cu.id and x->>'unit_key' = v_key))
          || public.report_totals((select jsonb_agg(x) from jsonb_array_elements(v_lines) x where (x->>'customer_id')::uuid = cu.id)) as c
        from public.customers cu
        where exists (select 1 from jsonb_array_elements(v_lines) x where (x->>'customer_id')::uuid = cu.id)
      ) t
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_item_analytics(uuid, date, date) from public, anon;
grant execute on function public.get_item_analytics(uuid, date, date) to authenticated;

-- Daily price updates: the price in force at the end of the chosen day for
-- every active product, and the days on which prices were set (newest first).
create or replace function public.get_daily_prices(p_date date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_end timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Manila') - interval '1 microsecond';
begin
  if not public.is_active_administrator() then
    raise exception 'Reports are available to administrators only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'date', p_date,
    'dates', coalesce((select jsonb_agg(d order by d desc) from (
        select distinct (effective_from at time zone 'Asia/Manila')::date as d from public.price_history where product_sku_id is null order by 1 desc limit 14) x), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
          'product_id', p.id, 'name', p.product_name, 'unit', p.unit_of_measurement, 'sku', (public.default_unit_sku(p.id)).selling_sku,
          'cost_price', pr.cost_price, 'selling_price', pr.selling_price, 'margin_percent', public.margin_percent(pr.cost_price, pr.selling_price),
          'set_on_date', (pr.effective_from at time zone 'Asia/Manila')::date = p_date
        ) order by lower(p.product_name))
      from public.products p
      left join lateral public.product_price_at(p.id, v_end) pr on true
      where p.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_daily_prices(date) from public, anon;
grant execute on function public.get_daily_prices(date) to authenticated;

-- Batch update editor: the latest price of every active product and, to
-- compare against, the price before the chosen date (the last batch).
-- Open to administrators and administrative staff, like other price changes.
create or replace function public.get_batch_price_sheet(p_price_date date, p_compare_date date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_before timestamptz := (p_price_date::timestamp at time zone 'Asia/Manila') - interval '1 microsecond';
  v_compare date;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can change products and prices' using errcode = '42501';
  end if;
  -- Compare against the chosen earlier date, or the last batch before the price date.
  v_compare := coalesce(p_compare_date, (select max((effective_from at time zone 'Asia/Manila')::date) from public.price_history where product_sku_id is null and effective_from <= v_before));
  if v_compare is not null and v_compare < p_price_date then
    v_before := ((v_compare + 1)::timestamp at time zone 'Asia/Manila') - interval '1 microsecond';
  end if;
  return jsonb_build_object(
    'price_date', p_price_date,
    'compare_date', v_compare,
    'compare_dates', coalesce((select jsonb_agg(d order by d desc) from (
        select distinct (effective_from at time zone 'Asia/Manila')::date as d from public.price_history
        where product_sku_id is null and effective_from < (p_price_date::timestamp at time zone 'Asia/Manila') order by 1 desc limit 14) x), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
          'product_id', p.id, 'name', p.product_name, 'unit', p.unit_of_measurement, 'sku', (public.default_unit_sku(p.id)).selling_sku,
          'cost_price', coalesce(sched.cost_price, cur.cost_price), 'selling_price', coalesce(sched.selling_price, cur.selling_price),
          'last_cost', last.cost_price, 'last_selling', last.selling_price
        ) order by lower(p.product_name))
      from public.products p
      left join lateral public.product_price_at(p.id, now()) cur on true
      left join lateral public.product_price_at(p.id, v_before) last on true
      left join lateral (select * from public.price_history h where h.product_id = p.id and h.product_sku_id is null
                         and h.effective_from = (p_price_date::timestamp at time zone 'Asia/Manila') and p_price_date > public.manila_today() limit 1) sched on true
      where p.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_batch_price_sheet(date, date) from public, anon;
grant execute on function public.get_batch_price_sheet(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Older report functions: administrators only
-- ---------------------------------------------------------------------------
-- The old functions are renamed and kept, and each name now checks for an
-- administrator before returning the same rows.

do $do$
declare
  r record;
  v_call text;
begin
  for r in
    select p.oid, p.proname, pg_get_function_arguments(p.oid) as args_def, pg_get_function_identity_arguments(p.oid) as args,
      pg_get_function_result(p.oid) as result, coalesce(p.proargnames, '{}') as names, p.pronargs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('get_customer_report', 'get_order_report', 'get_product_quantity_report', 'get_purchasing_report', 'get_delivery_report', 'get_margin_report', 'get_order_margin_summary')
  loop
    v_call := (select coalesce(string_agg(quote_ident(r.names[i]), ', ' order by i), '') from generate_series(1, r.pronargs) i);
    execute format('alter function public.%I(%s) rename to %I', r.proname, r.args, r.proname || '_unchecked');
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', r.proname || '_unchecked', r.args);
    execute format($f$create function public.%I(%s) returns %s language plpgsql stable security definer set search_path = public as $b$
      begin
        if not public.is_active_administrator() then
    raise exception 'Reports are available to administrators only' using errcode = '42501';
  end if;
        return query select * from public.%I(%s);
      end;
    $b$ $f$, r.proname, r.args_def, r.result, r.proname || '_unchecked', v_call);
    execute format('revoke all on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
  end loop;
end $do$;
