-- Phase 3 (rollout tasks 3.1 and 3.2): order discount, sales invoice number
-- (SI#), delivery time slots and order sources.
--
-- Additive. The old app keeps working: no column it reads changes, and it
-- never writes to these tables directly. Rollback: drop the new functions,
-- the view-like money functions, the new columns and the two new tables.
--
-- Decisions (Jac, 2026-11-03):
--   D-O1  Administrators and administrative staff may apply discounts and set SI#.
--   D-O2  The order discount applies after per-item special prices. An applied
--         discount is always more than zero: a percentage is more than 0 and
--         at most 100, and a fixed (peso) discount is more than 0 and at most
--         the subtotal. "No discount" means removing it (Remove), never 0.
--         Money is worked out here, on the server, to two decimal places.
--         Applying or removing a discount needs a reason. Completed and
--         cancelled orders refuse discount changes.
--   Follow-ups (Jac, 2026-11-03):
--     * Totals of orders that exist before this migration never change.
--       They keep the old rule (lines added unrounded, as every report did);
--       new orders round each line to centavos first (money_rounding).
--     * SI#: on a completed order, administrators and administrative staff
--       may add a missing SI#; replacing or clearing one needs an
--       administrator and a reason. Cancelled orders are locked. The format
--       stays; the same SI# may appear on more than one order.

-- ---------------------------------------------------------------------------
-- 1. Lookup tables (managed from admin screens in Phase 4)
-- ---------------------------------------------------------------------------

create table if not exists public.delivery_time_slots (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) between 1 and 60),
  starts_at time,
  ends_at time,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint delivery_time_slots_window check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create table if not exists public.order_sources (
  id uuid primary key default gen_random_uuid(),
  -- The matching value of the old order_source enum, for the Phase 4 backfill.
  code text unique,
  label text not null check (length(trim(label)) between 1 and 60),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists order_sources_label_key on public.order_sources (lower(label));

insert into public.order_sources (code, label, sort_order) values
  ('viber', 'Viber', 1),
  ('messenger', 'Messenger', 2),
  ('phone', 'Phone', 3),
  ('purchase_order', 'Purchase order', 4),
  ('other', 'Other', 5)
on conflict (code) do nothing;

alter table public.delivery_time_slots enable row level security;
alter table public.order_sources enable row level security;
revoke all on table public.delivery_time_slots, public.order_sources from anon, authenticated;
grant select on table public.delivery_time_slots, public.order_sources to authenticated;
drop policy if exists "active_staff_read_delivery_time_slots" on public.delivery_time_slots;
create policy "active_staff_read_delivery_time_slots" on public.delivery_time_slots
  for select to authenticated using (public.is_active_account());
drop policy if exists "active_staff_read_order_sources" on public.order_sources;
create policy "active_staff_read_order_sources" on public.order_sources
  for select to authenticated using (public.is_active_account());

-- ---------------------------------------------------------------------------
-- 2. New order columns
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists discount_type text,
  add column if not exists discount_value numeric(12, 2),
  add column if not exists discount_reason text,
  add column if not exists discount_by uuid references public.profiles(id) on delete restrict,
  add column if not exists discount_at timestamptz,
  add column if not exists sales_invoice_number text,
  add column if not exists delivery_time_slot_id uuid references public.delivery_time_slots(id) on delete restrict,
  -- Sits next to the old enum column until Phase 4 backfills and requires it.
  add column if not exists order_source_id uuid references public.order_sources(id) on delete restrict;

alter table public.orders drop constraint if exists orders_discount_complete;
alter table public.orders add constraint orders_discount_complete check (
  (discount_type is null and discount_value is null and discount_reason is null and discount_by is null and discount_at is null)
  or (
    discount_type in ('fixed', 'percent')
    and discount_value > 0
    and (discount_type <> 'percent' or discount_value <= 100)
    and nullif(trim(discount_reason), '') is not null
    and discount_by is not null
    and discount_at is not null
  )
);
alter table public.orders drop constraint if exists orders_sales_invoice_number_format;
alter table public.orders add constraint orders_sales_invoice_number_format check (
  sales_invoice_number is null or sales_invoice_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./#-]{0,39}$'
);

-- How an order's subtotal is added up. Orders that exist now are marked
-- 'order_sum' (unrounded line amounts added, then shown to two decimals, which
-- is what every report already did), so no historical total moves by a
-- centavo. The default for every order created afterwards is 'line': each
-- line is rounded to centavos first, so lines and subtotal always agree.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'money_rounding') then
    alter table public.orders add column money_rounding text not null default 'order_sum';
    alter table public.orders alter column money_rounding set default 'line';
  end if;
end $$;
alter table public.orders drop constraint if exists orders_money_rounding_check;
alter table public.orders add constraint orders_money_rounding_check check (money_rounding in ('order_sum', 'line'));

-- Each line's amount rounded to centavos, for display and for 'line' orders.
alter table public.order_items
  add column if not exists line_total numeric(14, 2) generated always as (round(quantity * unit_price, 2)) stored;
grant select (line_total) on public.order_items to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Money, worked out in one place
-- ---------------------------------------------------------------------------

create or replace function public.order_discount_amount(p_subtotal numeric, p_type text, p_value numeric)
returns numeric
language sql immutable set search_path = public
as $$
  select (case
    when p_type = 'fixed' then least(round(p_value, 2), round(p_subtotal, 2))
    when p_type = 'percent' then round(round(p_subtotal, 2) * least(p_value, 100) / 100, 2)
    else 0
  end)::numeric(14, 2);
$$;

-- These take an orders row, so the REST API also offers them as computed
-- columns: select=id,order_subtotal,order_discount,order_total. They run with
-- the caller's rights, so a caller only adds up lines they may read.
create or replace function public.order_subtotal(p_order public.orders)
returns numeric
language sql stable set search_path = public
as $$
  select case
    when p_order.money_rounding = 'order_sum' then coalesce(sum(oi.quantity * oi.unit_price), 0)
    else coalesce(sum(oi.line_total), 0)::numeric(14, 2)
  end
  from public.order_items oi where oi.order_id = p_order.id;
$$;

create or replace function public.order_discount(p_order public.orders)
returns numeric
language sql stable set search_path = public
as $$
  select public.order_discount_amount(public.order_subtotal(p_order), p_order.discount_type, p_order.discount_value);
$$;

create or replace function public.order_total(p_order public.orders)
returns numeric
language sql stable set search_path = public
as $$
  select public.order_subtotal(p_order) - public.order_discount(p_order);
$$;

revoke all on function public.order_discount_amount(numeric, text, numeric) from public, anon;
revoke all on function public.order_subtotal(public.orders) from public, anon;
revoke all on function public.order_discount(public.orders) from public, anon;
revoke all on function public.order_total(public.orders) from public, anon;
grant execute on function public.order_discount_amount(numeric, text, numeric) to authenticated;
grant execute on function public.order_subtotal(public.orders) to authenticated;
grant execute on function public.order_discount(public.orders) to authenticated;
grant execute on function public.order_total(public.orders) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Orders change only through the RPCs
-- ---------------------------------------------------------------------------
-- The app never writes these tables directly. Until now an office account
-- could update an unverified order's row through the REST API, which would
-- also let it set a discount without a reason or a log entry.
drop policy if exists "administrative_edit_unverified_orders" on public.orders;
revoke insert, update, delete on public.orders, public.order_items, public.order_activity from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Retry protection for the new RPCs (client_request_id)
-- ---------------------------------------------------------------------------
-- The same request id from the same person returns the first result and
-- changes nothing again. Reusing an id for different details is refused.
create or replace function public.begin_client_request(p_rpc text, p_request_id uuid, p_args jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.mutation_requests;
  v_hash text := md5(coalesce(p_args, '{}'::jsonb)::text);
begin
  if p_request_id is null then
    raise exception 'A request id is required' using errcode = '22023';
  end if;
  insert into public.mutation_requests (user_id, request_id, rpc_name, args_hash)
  values (auth.uid(), p_request_id, p_rpc, v_hash)
  on conflict (user_id, request_id) do nothing;
  if found then
    return null;
  end if;
  select * into v_row from public.mutation_requests m
    where m.user_id = auth.uid() and m.request_id = p_request_id;
  if v_row.rpc_name <> p_rpc or v_row.args_hash <> v_hash then
    raise exception 'request_id_reused' using errcode = 'P0001';
  end if;
  return coalesce(v_row.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
end;
$$;

create or replace function public.finish_client_request(p_request_id uuid, p_result jsonb)
returns void
language sql security definer set search_path = public
as $$
  update public.mutation_requests
    set status = 'done', result = p_result, completed_at = now()
    where user_id = auth.uid() and request_id = p_request_id;
$$;

revoke all on function public.begin_client_request(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finish_client_request(uuid, jsonb) from public, anon, authenticated;

create or replace function public.order_money(p_order public.orders)
returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'order_id', p_order.id,
    'subtotal', public.order_subtotal(p_order),
    'discount_amount', public.order_discount(p_order),
    'total', public.order_total(p_order)
  );
$$;
revoke all on function public.order_money(public.orders) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Discount and SI# RPCs
-- ---------------------------------------------------------------------------

create or replace function public.apply_order_discount(
  p_order_id uuid,
  p_discount_type text,
  p_discount_value numeric,
  p_reason text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_replay jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_subtotal numeric;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to apply discounts' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('apply_order_discount', p_client_request_id,
    jsonb_build_object('order_id', p_order_id, 'type', p_discount_type, 'value', p_discount_value, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status in ('completed', 'cancelled') then
    raise exception 'Discounts cannot be changed on a completed or cancelled order';
  end if;
  if p_discount_type is null or p_discount_type not in ('fixed', 'percent') then
    raise exception 'Choose a fixed amount or a percentage';
  end if;
  if p_discount_value is null or p_discount_value <= 0 then
    raise exception 'Enter a discount greater than zero';
  end if;
  if p_discount_value <> round(p_discount_value, 2) then
    raise exception 'Use at most two decimal places';
  end if;
  if p_discount_type = 'percent' and p_discount_value > 100 then
    raise exception 'A percentage discount cannot be more than 100%%';
  end if;
  if v_reason is null then
    raise exception 'A reason is required for a discount';
  end if;
  if length(v_reason) > 200 then
    raise exception 'Keep the reason to 200 characters or fewer';
  end if;
  v_subtotal := public.order_subtotal(v_order);
  if p_discount_type = 'fixed' and p_discount_value > v_subtotal then
    raise exception 'The discount cannot be more than the subtotal of %', to_char(v_subtotal, 'FM999,999,990.00');
  end if;

  update public.orders
    set discount_type = p_discount_type, discount_value = p_discount_value, discount_reason = v_reason,
        discount_by = auth.uid(), discount_at = now()
    where id = p_order_id
    returning * into v_order;
  v_result := public.order_money(v_order);
  insert into public.order_activity (order_id, user_id, action, details)
  values (p_order_id, auth.uid(), 'discount_applied', jsonb_build_object(
    'type', p_discount_type, 'value', p_discount_value, 'reason', v_reason,
    'amount', v_result -> 'discount_amount', 'total', v_result -> 'total'));
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

create or replace function public.remove_order_discount(p_order_id uuid, p_reason text, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_replay jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_previous jsonb;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to change discounts' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('remove_order_discount', p_client_request_id, jsonb_build_object('order_id', p_order_id, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status in ('completed', 'cancelled') then
    raise exception 'Discounts cannot be changed on a completed or cancelled order';
  end if;
  if v_order.discount_type is null then
    raise exception 'This order has no discount';
  end if;
  if v_reason is null then
    raise exception 'A reason is required to remove a discount';
  end if;
  if length(v_reason) > 200 then
    raise exception 'Keep the reason to 200 characters or fewer';
  end if;
  v_previous := jsonb_build_object('type', v_order.discount_type, 'value', v_order.discount_value,
    'reason', v_order.discount_reason, 'amount', public.order_discount(v_order));

  update public.orders
    set discount_type = null, discount_value = null, discount_reason = null, discount_by = null, discount_at = null
    where id = p_order_id
    returning * into v_order;
  v_result := public.order_money(v_order);
  insert into public.order_activity (order_id, user_id, action, details)
  values (p_order_id, auth.uid(), 'discount_removed', jsonb_build_object('reason', v_reason, 'previous', v_previous, 'total', v_result -> 'total'));
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

-- SI# rules:
--   * Open orders: administrators and administrative staff may add, change
--     or clear it.
--   * Completed orders: they may add a missing SI#. Replacing or clearing an
--     existing one needs an administrator and a reason.
--   * Cancelled orders: locked.
-- An empty value clears it. Every change logs the previous and new values.
create or replace function public.set_sales_invoice_number(p_order_id uuid, p_sales_invoice_number text, p_reason text, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_replay jsonb;
  v_value text := nullif(trim(coalesce(p_sales_invoice_number, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to set the sales invoice number' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('set_sales_invoice_number', p_client_request_id,
    jsonb_build_object('order_id', p_order_id, 'value', p_sales_invoice_number, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = 'cancelled' then
    raise exception 'A cancelled order cannot get a sales invoice number';
  end if;
  if v_value is not null and v_value !~ '^[A-Za-z0-9][A-Za-z0-9 ./#-]{0,39}$' then
    raise exception 'Use up to 40 letters, numbers, spaces or . / # -';
  end if;
  if v_reason is not null and length(v_reason) > 200 then
    raise exception 'Keep the reason to 200 characters or fewer';
  end if;
  if v_order.status = 'completed' and v_order.sales_invoice_number is not null
     and v_order.sales_invoice_number is distinct from v_value then
    if not public.is_active_administrator() then
      raise exception 'Only an administrator can change or remove the SI# of a completed order' using errcode = '42501';
    end if;
    if v_reason is null then
      raise exception 'A reason is required to change or remove the SI# of a completed order';
    end if;
  end if;

  if v_order.sales_invoice_number is distinct from v_value then
    update public.orders set sales_invoice_number = v_value where id = p_order_id;
    insert into public.order_activity (order_id, user_id, action, details)
    values (p_order_id, auth.uid(), 'sales_invoice_set', jsonb_build_object('from', v_order.sales_invoice_number, 'to', v_value, 'reason', v_reason));
  end if;
  v_result := jsonb_build_object('order_id', p_order_id, 'sales_invoice_number', v_value);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

revoke all on function public.apply_order_discount(uuid, text, numeric, text, uuid) from public, anon;
revoke all on function public.remove_order_discount(uuid, text, uuid) from public, anon;
revoke all on function public.set_sales_invoice_number(uuid, text, text, uuid) from public, anon;
grant execute on function public.apply_order_discount(uuid, text, numeric, text, uuid) to authenticated;
grant execute on function public.remove_order_discount(uuid, text, uuid) to authenticated;
grant execute on function public.set_sales_invoice_number(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Editing keeps the prices the order was taken at
-- ---------------------------------------------------------------------------
-- Same rules as before, with two changes:
--   * A line that stays on the order (same product, SKU, variety and unit, same
--     customer) keeps its unit price, cost and any approved special price.
--     Only new lines, or every line when the customer changes, get today's price.
--   * A fixed discount larger than the new subtotal is refused (D-O2).
create or replace function public.edit_order_with_items(p_order_id uuid, p_order jsonb, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_customer uuid;
  v_item jsonb;
  v_old jsonb;
  v_match jsonb;
  v_used integer[] := '{}';
  v_product_id uuid;
  v_sku_id uuid;
  v_variety_id uuid;
  v_unit text;
  v_price numeric(12, 2);
  v_cost numeric(12, 2);
  v_before jsonb;
  v_after jsonb;
  v_subtotal numeric;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to edit orders';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'An order requires at least one item';
  end if;
  if nullif(trim(coalesce(p_order->>'customer_id', '')), '') is null or nullif(trim(coalesce(p_order->>'requested_delivery_date', '')), '') is null then
    raise exception 'Customer and delivery date are required';
  end if;
  if (p_order->>'requested_delivery_date')::date < current_date then
    raise exception 'Delivery date cannot be in the past';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status <> 'for_verification' then raise exception 'Only orders awaiting verification can be edited'; end if;
  v_customer := (p_order->>'customer_id')::uuid;
  if not exists(select 1 from public.customers where id = v_customer and status = 'active') then raise exception 'Selected customer is unavailable'; end if;

  select jsonb_build_object(
    'customer_id', o.customer_id,
    'requested_delivery_date', o.requested_delivery_date,
    'notes', o.notes,
    'items', coalesce(jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'product_sku_id', oi.product_sku_id, 'variety_id', oi.variety_id, 'quantity', oi.quantity, 'unit_of_measurement', oi.unit_of_measurement, 'unit_price', oi.unit_price, 'notes', oi.notes)) filter (where oi.id is not null), '[]'::jsonb)
  ) into v_before
  from public.orders o left join public.order_items oi on oi.order_id = o.id
  where o.id = p_order_id group by o.id;

  -- Lines that can keep their price: only while the customer stays the same.
  select coalesce(jsonb_agg(to_jsonb(oi) order by oi.created_at, oi.id), '[]'::jsonb) into v_old
  from public.order_items oi
  where oi.order_id = p_order_id and v_order.customer_id = v_customer;

  update public.orders set customer_id = v_customer, requested_delivery_date = (p_order->>'requested_delivery_date')::date, notes = nullif(trim(p_order->>'notes'), '') where id = p_order_id;
  delete from public.order_items where order_id = p_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_sku_id := nullif(v_item->>'product_sku_id', '')::uuid;
    v_variety_id := nullif(v_item->>'variety_id', '')::uuid;
    v_unit := trim(coalesce(v_item->>'unit_of_measurement', ''));
    if coalesce((v_item->>'quantity')::numeric, 0) <= 0 or v_unit = '' then raise exception 'Every item needs a positive quantity and unit'; end if;
    if not exists(select 1 from public.products where id = v_product_id and status = 'active') then raise exception 'Selected product is unavailable'; end if;
    if v_sku_id is not null and not exists(select 1 from public.product_skus where id = v_sku_id and product_id = v_product_id and status = 'active') then raise exception 'Selected SKU does not belong to product'; end if;
    if v_variety_id is not null and not exists(select 1 from public.product_varieties where id = v_variety_id and product_id = v_product_id and status = 'active') then raise exception 'Selected variety does not belong to product'; end if;

    v_match := null;
    for i in 0 .. jsonb_array_length(v_old) - 1 loop
      if not (i = any(v_used))
        and (v_old->i->>'product_id')::uuid = v_product_id
        and nullif(v_old->i->>'product_sku_id', '')::uuid is not distinct from v_sku_id
        and nullif(v_old->i->>'variety_id', '')::uuid is not distinct from v_variety_id
        and v_old->i->>'unit_of_measurement' = v_unit then
        v_match := v_old->i;
        v_used := v_used || i;
        exit;
      end if;
    end loop;

    if v_match is not null then
      insert into public.order_items(order_id, product_id, product_sku_id, variety_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price, special_price, special_price_reason, special_price_authorized_by, special_price_authorized_at, notes)
      values (p_order_id, v_product_id, v_sku_id, v_variety_id, (v_item->>'quantity')::numeric, v_unit,
        (v_match->>'unit_price')::numeric, (v_match->>'original_unit_price')::numeric, (v_match->>'cost_price')::numeric,
        nullif(v_match->>'special_price', '')::numeric, v_match->>'special_price_reason',
        nullif(v_match->>'special_price_authorized_by', '')::uuid, nullif(v_match->>'special_price_authorized_at', '')::timestamptz,
        nullif(trim(v_item->>'notes'), ''));
    else
      v_price := null;
      v_cost := null;
      select cp.selling_price into v_price from public.customer_pricing cp where cp.customer_id = v_customer and cp.product_id = v_product_id and (cp.product_sku_id is not distinct from v_sku_id) and cp.effective_from <= now() and (cp.effective_to is null or cp.effective_to > now()) order by cp.effective_from desc limit 1;
      if v_price is null then select ph.selling_price, ph.cost_price into v_price, v_cost from public.price_history ph where ph.product_id = v_product_id and (ph.product_sku_id is not distinct from v_sku_id) and ph.effective_from <= now() and (ph.effective_to is null or ph.effective_to > now()) order by ph.effective_from desc limit 1; end if;
      if v_price is null then raise exception 'No active price exists for selected product'; end if;
      if v_cost is null then select ph.cost_price into v_cost from public.price_history ph where ph.product_id = v_product_id and (ph.product_sku_id is not distinct from v_sku_id) and ph.effective_from <= now() and (ph.effective_to is null or ph.effective_to > now()) order by ph.effective_from desc limit 1; end if;
      insert into public.order_items(order_id, product_id, product_sku_id, variety_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price, notes)
      values (p_order_id, v_product_id, v_sku_id, v_variety_id, (v_item->>'quantity')::numeric, v_unit, v_price, v_price, coalesce(v_cost, 0), nullif(trim(v_item->>'notes'), ''));
    end if;
  end loop;

  select * into v_order from public.orders where id = p_order_id;
  v_subtotal := public.order_subtotal(v_order);
  if v_order.discount_type = 'fixed' and v_order.discount_value > v_subtotal then
    raise exception 'The discount is more than the new subtotal of %. Lower or remove the discount first.', to_char(v_subtotal, 'FM999,999,990.00');
  end if;

  select jsonb_build_object('customer_id', o.customer_id, 'requested_delivery_date', o.requested_delivery_date, 'notes', o.notes, 'item_count', count(oi.id)) into v_after from public.orders o left join public.order_items oi on oi.order_id = o.id where o.id = p_order_id group by o.id;
  insert into public.order_activity(order_id, user_id, action, details) values (p_order_id, auth.uid(), 'order_edited', jsonb_build_object('before', v_before, 'after', v_after));
end;
$$;
revoke all on function public.edit_order_with_items(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.edit_order_with_items(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Reports use the same totals as Order detail
-- ---------------------------------------------------------------------------

create or replace function public.get_order_report(p_start date default null, p_end date default null, p_customer_id uuid default null, p_status public.order_status default null, p_limit integer default 25, p_offset integer default 0)
returns table(order_id uuid, order_number text, customer_name text, status public.order_status, requested_delivery_date date, item_count bigint, total numeric, total_rows bigint)
language sql stable security definer set search_path = public as $$
  select o.id, o.order_number, c.business_name, o.status, o.requested_delivery_date,
    (select count(*) from public.order_items oi where oi.order_id = o.id),
    public.order_total(o),
    count(*) over()
  from public.orders o join public.customers c on c.id = o.customer_id
  where public.can_read_order(o.id)
    and (p_start is null or o.requested_delivery_date >= p_start)
    and (p_end is null or o.requested_delivery_date <= p_end)
    and (p_customer_id is null or o.customer_id = p_customer_id)
    and (p_status is null or o.status = p_status)
  order by o.requested_delivery_date desc, o.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.get_order_report(date,date,uuid,public.order_status,integer,integer) from public, anon;
grant execute on function public.get_order_report(date,date,uuid,public.order_status,integer,integer) to authenticated;

create or replace function public.get_customer_report(
  p_start date default null,
  p_end date default null,
  p_customer_id uuid default null,
  p_status public.order_status default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table(
  customer_id uuid,
  customer_code text,
  customer_name text,
  customer_status public.record_status,
  order_count bigint,
  quantity_by_unit jsonb,
  status_summary jsonb,
  recent_order_date date,
  total_order_amount numeric,
  total_rows bigint
)
language sql stable security definer set search_path = public as $$
  with filtered_orders as (
    select o.id, o.customer_id, o.status, o.requested_delivery_date, public.order_total(o) as order_total
    from public.orders o
    where public.can_read_order(o.id)
      and (p_start is null or o.requested_delivery_date >= p_start)
      and (p_end is null or o.requested_delivery_date <= p_end)
      and (p_customer_id is null or o.customer_id = p_customer_id)
      and (p_status is null or o.status = p_status)
  ),
  quantities as (
    select q.customer_id,
      jsonb_object_agg(unit_of_measurement, quantity order by unit_of_measurement) as quantity_by_unit
    from (
      select fo.customer_id, oi.unit_of_measurement, sum(oi.quantity) as quantity
      from filtered_orders fo join public.order_items oi on oi.order_id = fo.id
      group by fo.customer_id, oi.unit_of_measurement
    ) q
    group by q.customer_id
  ),
  statuses as (
    select customer_id, jsonb_object_agg(status::text, count_by_status order by status::text) as status_summary
    from (
      select customer_id, status, count(*) as count_by_status
      from filtered_orders
      group by customer_id, status
    ) s
    group by customer_id
  ),
  summaries as (
    select c.id as customer_id, c.customer_code, c.business_name as customer_name, c.status as customer_status,
      count(fo.id) as order_count, coalesce(q.quantity_by_unit, '{}'::jsonb) as quantity_by_unit,
      coalesce(s.status_summary, '{}'::jsonb) as status_summary, max(fo.requested_delivery_date) as recent_order_date,
      coalesce(sum(fo.order_total), 0) as total_order_amount
    from public.customers c
    left join filtered_orders fo on fo.customer_id = c.id
    left join quantities q on q.customer_id = c.id
    left join statuses s on s.customer_id = c.id
    where public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[])
      and (p_customer_id is null or c.id = p_customer_id)
    group by c.id, c.customer_code, c.business_name, c.status, q.quantity_by_unit, s.status_summary
  )
  select *, count(*) over()
  from summaries
  where order_count > 0 or p_customer_id is not null
  order by recent_order_date desc nulls last, customer_name
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.get_customer_report(date,date,uuid,public.order_status,integer,integer) from public, anon;
grant execute on function public.get_customer_report(date,date,uuid,public.order_status,integer,integer) to authenticated;

create or replace function public.get_customer_order_history(
  p_customer_id uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(
  order_id uuid,
  order_number text,
  order_date timestamptz,
  status public.order_status,
  requested_delivery_date date,
  total numeric,
  total_rows bigint
)
language sql stable security definer set search_path = public as $$
  select o.id, o.order_number, o.created_at, o.status, o.requested_delivery_date,
    public.order_total(o) as total, count(*) over()
  from public.orders o
  where o.customer_id = p_customer_id
    and public.can_read_order(o.id)
  order by o.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.get_customer_order_history(uuid,integer,integer) from public, anon;
grant execute on function public.get_customer_order_history(uuid,integer,integer) to authenticated;

create or replace function public.get_order_margin_summary()
returns table(total_cost numeric, total_selling numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to view margin information';
  end if;

  -- Selling is what customers pay: line totals less order discounts.
  return query
  select
    (select coalesce(sum(oi.quantity * oi.cost_price), 0) from public.order_items oi),
    (select coalesce(sum(public.order_total(o)), 0) from public.orders o);
end;
$$;
revoke all on function public.get_order_margin_summary() from public, anon;
grant execute on function public.get_order_margin_summary() to authenticated;
