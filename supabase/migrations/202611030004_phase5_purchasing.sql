-- Phase 5 (rollout tasks 5.1 to 5.5): Purchasing. To pack with a packing
-- checklist that survives a reload, and To buy for a date range.
--
-- Additive. The old app keeps calling update_preparation_status and
-- transition_order_status, which are unchanged. Rollback: drop the functions
-- below.
--
-- PROVISIONAL rules (Jac 2026-11-03, until D-S2 and D-P1 are decided):
--   * To buy counts Confirmed and For preparation orders only.
--   * Stock is never reserved or deducted by packing. Inventory changes only
--     through the manual adjustment screen (adjust_inventory).
--   * "Advance orders" are orders due after tomorrow (Asia/Manila dates). The
--     app works this out; the server gives it today's Manila date.

-- ---------------------------------------------------------------------------
-- 1. Packing (tasks 5.1 and 5.2)
-- ---------------------------------------------------------------------------
-- Every packing change locks the order and checks its status again on the
-- server, so an order cancelled (or moved on) on another phone cannot be
-- packed or advanced. A retry with the same client_request_id returns the
-- first result instead of acting twice.

create or replace function public.packing_order_problem(p_status public.order_status)
returns text
language sql immutable
as $$
  select case p_status
    when 'for_preparation' then null
    when 'cancelled' then 'This order was cancelled, so it can no longer be packed.'
    when 'confirmed' then 'Packing has not started for this order. Tap Start packing first.'
    when 'for_delivery' then 'This order is already packed and waiting for delivery.'
    when 'completed' then 'This order has already been delivered.'
    else 'This order is not confirmed yet, so it cannot be packed.'
  end;
$$;
revoke all on function public.packing_order_problem(public.order_status) from public;

-- Progress of one order's checklist, returned after every change.
create or replace function public.packing_progress(p_order_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'status', o.status,
    'packed_count', (select count(*) from public.order_items i where i.order_id = o.id and i.preparation_status = 'completed'),
    'item_count', (select count(*) from public.order_items i where i.order_id = o.id))
  from public.orders o where o.id = p_order_id;
$$;
revoke all on function public.packing_progress(uuid) from public, anon, authenticated;

create or replace function public.start_packing(p_order_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_replay jsonb;
  v_status public.order_status;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to pack orders' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('start_packing', p_client_request_id, jsonb_build_object('order_id', p_order_id));
  if v_replay is not null then return v_replay; end if;

  select status into v_status from public.orders where id = p_order_id for update;
  if v_status is null then raise exception 'Order not found'; end if;
  if v_status = 'for_preparation' then
    raise exception 'Packing has already started for this order.';
  elsif v_status <> 'confirmed' then
    raise exception '%', coalesce(public.packing_order_problem(v_status), 'This order cannot be packed now.');
  end if;

  update public.orders set status = 'for_preparation' where id = p_order_id;
  insert into public.order_activity(order_id, user_id, action, details)
  values (p_order_id, auth.uid(), 'status_changed',
    jsonb_build_object('from_status', 'confirmed', 'to_status', 'for_preparation', 'source', 'purchasing'));

  v_result := public.packing_progress(p_order_id);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

-- Figma "Cancel packing": the order goes back to Ready to start. Ticks are
-- kept, so nothing already packed has to be ticked again.
create or replace function public.cancel_packing(p_order_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_replay jsonb;
  v_status public.order_status;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to pack orders' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('cancel_packing', p_client_request_id, jsonb_build_object('order_id', p_order_id));
  if v_replay is not null then return v_replay; end if;

  select status into v_status from public.orders where id = p_order_id for update;
  if v_status is null then raise exception 'Order not found'; end if;
  if v_status <> 'for_preparation' then
    raise exception '%', public.packing_order_problem(v_status);
  end if;

  update public.orders set status = 'confirmed' where id = p_order_id;
  insert into public.order_activity(order_id, user_id, action, details)
  values (p_order_id, auth.uid(), 'status_changed',
    jsonb_build_object('from_status', 'for_preparation', 'to_status', 'confirmed', 'source', 'purchasing', 'reason', 'packing_cancelled'));

  v_result := public.packing_progress(p_order_id);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

-- Tick or untick one line. Ticking the last line moves the order to For
-- delivery, as before. Unticking is allowed while the order is still being
-- packed, to undo a mistaken tap.
create or replace function public.set_item_packed(p_item_id uuid, p_packed boolean, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_replay jsonb;
  v_order_id uuid;
  v_status public.order_status;
  v_previous public.preparation_status;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to pack orders' using errcode = '42501';
  end if;
  if p_packed is null then raise exception 'Say whether the item is packed'; end if;
  v_replay := public.begin_client_request('set_item_packed', p_client_request_id,
    jsonb_build_object('item_id', p_item_id, 'packed', p_packed));
  if v_replay is not null then return v_replay; end if;

  -- Lock the order first (the same order transition_order_status uses), then
  -- the line, and only then read the status.
  select order_id into v_order_id from public.order_items where id = p_item_id;
  if v_order_id is null then raise exception 'Item not found'; end if;
  select status into v_status from public.orders where id = v_order_id for update;
  if v_status <> 'for_preparation' then
    raise exception '%', public.packing_order_problem(v_status);
  end if;
  select preparation_status into v_previous from public.order_items where id = p_item_id for update;

  if p_packed and v_previous <> 'completed' then
    update public.order_items
      set preparation_status = 'completed',
          preparation_started_by = coalesce(preparation_started_by, auth.uid()),
          preparation_started_at = coalesce(preparation_started_at, now()),
          prepared_by = auth.uid(),
          prepared_at = now()
      where id = p_item_id;
    insert into public.order_activity(order_id, user_id, action, details)
    values (v_order_id, auth.uid(), 'preparation_status_changed',
      jsonb_build_object('item_id', p_item_id, 'from_status', v_previous, 'to_status', 'completed'));

    if not exists (select 1 from public.order_items where order_id = v_order_id and preparation_status <> 'completed') then
      update public.orders set status = 'for_delivery' where id = v_order_id;
      insert into public.order_activity(order_id, user_id, action, details)
      values (v_order_id, auth.uid(), 'status_changed',
        jsonb_build_object('from_status', 'for_preparation', 'to_status', 'for_delivery', 'reason', 'all_preparation_tasks_completed'));
    end if;
  elsif not p_packed and v_previous = 'completed' then
    update public.order_items
      set preparation_status = 'in_progress', prepared_by = null, prepared_at = null
      where id = p_item_id;
    insert into public.order_activity(order_id, user_id, action, details)
    values (v_order_id, auth.uid(), 'preparation_status_changed',
      jsonb_build_object('item_id', p_item_id, 'from_status', 'completed', 'to_status', 'in_progress', 'reason', 'unticked'));
  end if;
  -- Ticking a ticked line (or unticking an unticked one) changes nothing.

  v_result := public.packing_progress(v_order_id) || jsonb_build_object('item_id', p_item_id, 'packed', p_packed);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

revoke all on function public.start_packing(uuid, uuid) from public, anon;
revoke all on function public.cancel_packing(uuid, uuid) from public, anon;
revoke all on function public.set_item_packed(uuid, boolean, uuid) from public, anon;
grant execute on function public.start_packing(uuid, uuid) to authenticated;
grant execute on function public.cancel_packing(uuid, uuid) to authenticated;
grant execute on function public.set_item_packed(uuid, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Units that can be added together (task 5.3)
-- ---------------------------------------------------------------------------
-- Units are free text, so "kg", "Kg" and "kilo" are the same unit, and grams
-- can be counted as kilograms. Units with no known conversion (box, head,
-- crate, bundle) are only matched by name: a box is never compared with kg.

create or replace function public.unit_measure(p_unit text)
returns table(unit_key text, factor numeric)
language sql immutable
as $$
  with u as (select regexp_replace(lower(trim(coalesce(p_unit, ''))), '[\s.]+', '', 'g') as name)
  select
    case
      when name in ('kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms') then 'kg'
      when name in ('g', 'gm', 'gms', 'gram', 'grams') then 'kg'
      when name in ('l', 'liter', 'liters', 'litre', 'litres', 'ltr', 'ltrs') then 'l'
      when name in ('ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres') then 'l'
      when name in ('pc', 'pcs', 'piece', 'pieces') then 'pc'
      when name in ('dozen', 'doz') then 'pc'
      else regexp_replace(name, 's$', '')
    end,
    case
      when name in ('g', 'gm', 'gms', 'gram', 'grams') then 0.001
      when name in ('ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres') then 0.001
      when name in ('dozen', 'doz') then 12
      else 1
    end
  from u;
$$;
revoke all on function public.unit_measure(text) from public;
grant execute on function public.unit_measure(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. To buy (tasks 5.3 and 5.4)
-- ---------------------------------------------------------------------------
-- Demand per product and unit from Confirmed and For preparation orders due
-- in the range, next to the stock on hand in the same unit.
--
-- Stock is added up from the SKUs on its own, before it meets the order
-- lines, so each SKU's stock is counted exactly once however many lines or
-- orders ask for that product. Lines already ticked as packed still count:
-- packing does not deduct stock, so the stock figure still includes them.
--
-- p_from null means "everything due up to p_to", which keeps late orders that
-- were never packed on the list. p_to is required.

create or replace function public.get_buy_list(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_items jsonb;
  v_overdue integer;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to see the buy list' using errcode = '42501';
  end if;
  if p_to is null then raise exception 'Choose an end date'; end if;
  if p_from is not null and p_from > p_to then raise exception 'The start date must be on or before the end date'; end if;
  if p_from is not null and p_to - p_from > 92 then raise exception 'Choose a range of 93 days or fewer'; end if;

  with lines as (
    select i.order_id, i.product_id, m.unit_key, m.factor, trim(i.unit_of_measurement) as unit_text,
      i.quantity * m.factor as quantity
    from public.order_items i
    join public.orders o on o.id = i.order_id
    cross join lateral public.unit_measure(i.unit_of_measurement) m
    where o.status in ('confirmed', 'for_preparation')
      and o.requested_delivery_date <= p_to
      and (p_from is null or o.requested_delivery_date >= p_from)
  ),
  demand as (
    select product_id, unit_key, sum(quantity) as quantity, count(distinct order_id) as order_count,
      min(unit_text) filter (where factor = 1) as line_unit
    from lines group by product_id, unit_key
  ),
  stock as (
    select ps.product_id, m.unit_key, sum(coalesce(inv.current_quantity, 0) * m.factor) as quantity
    from public.product_skus ps
    left join public.inventory inv on inv.sku_id = ps.id
    cross join lateral public.unit_measure(ps.unit_of_measurement) m
    where ps.status = 'active'
    group by ps.product_id, m.unit_key
  ),
  -- The unit shown: the product's own unit when it is the same kind,
  -- otherwise the kind's usual name (kg, l, pc) or the unit as written.
  priced as (
    select d.product_id, p.product_name,
      coalesce(case when pm.unit_key = d.unit_key then trim(p.unit_of_measurement) end,
               case when d.unit_key in ('kg', 'l', 'pc') then d.unit_key end,
               d.line_unit, d.unit_key) as unit,
      case when pm.unit_key = d.unit_key then pm.factor else 1 end as shown_factor,
      d.quantity, d.order_count, st.quantity as stock
    from demand d
    join public.products p on p.id = d.product_id
    left join lateral public.unit_measure(p.unit_of_measurement) pm on true
    left join stock st on st.product_id = d.product_id and st.unit_key = d.unit_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product_id,
      'product_name', product_name,
      'unit', unit,
      'quantity', round(quantity / shown_factor, 3),
      'order_count', order_count,
      'stock', case when stock is null then null else round(stock / shown_factor, 3) end,
      'short_by', case when stock is null then null else round(greatest(quantity - stock, 0) / shown_factor, 3) end
    ) order by greatest(quantity - coalesce(stock, 0), 0) > 0 desc, product_name, unit), '[]'::jsonb)
  into v_items from priced;

  select count(*) into v_overdue from public.orders
    where status in ('confirmed', 'for_preparation') and requested_delivery_date < v_today
      and p_from is null and requested_delivery_date <= p_to;

  return jsonb_build_object('today', v_today, 'from', p_from, 'to', p_to, 'overdue_orders', v_overdue, 'items', v_items);
end;
$$;
revoke all on function public.get_buy_list(date, date) from public, anon;
grant execute on function public.get_buy_list(date, date) to authenticated;

-- Today's date in Manila, for the app's Today / Tomorrow / advance labels
-- when the phone's clock or time zone is wrong.
create or replace function public.manila_today()
returns date
language sql stable
as $$ select (now() at time zone 'Asia/Manila')::date; $$;
grant execute on function public.manila_today() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A changed line must be packed again (Jac 2026-11-03)
-- ---------------------------------------------------------------------------
-- If a line's product, SKU, quantity or unit changes after it was ticked, the
-- tick no longer matches what was packed, so it is cleared and logged. This
-- runs for every way a line can be changed, including future edit screens.

create or replace function public.clear_packing_tick_on_line_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.preparation_status = 'completed'
    and new.preparation_status = 'completed'
    and (new.product_id is distinct from old.product_id
      or new.product_sku_id is distinct from old.product_sku_id
      or new.quantity is distinct from old.quantity
      or lower(trim(new.unit_of_measurement)) is distinct from lower(trim(old.unit_of_measurement))) then
    new.preparation_status := 'in_progress';
    new.prepared_by := null;
    new.prepared_at := null;
    if auth.uid() is not null then
      insert into public.order_activity(order_id, user_id, action, details)
      values (new.order_id, auth.uid(), 'preparation_status_changed',
        jsonb_build_object('item_id', new.id, 'from_status', 'completed', 'to_status', 'in_progress', 'reason', 'line_changed'));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.clear_packing_tick_on_line_change() from public, anon, authenticated;

drop trigger if exists order_items_clear_packing_tick on public.order_items;
create trigger order_items_clear_packing_tick
  before update of product_id, product_sku_id, quantity, unit_of_measurement on public.order_items
  for each row execute function public.clear_packing_tick_on_line_change();
