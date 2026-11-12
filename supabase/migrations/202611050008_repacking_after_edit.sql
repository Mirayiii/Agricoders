-- Repacking after an order edit (approved by Jac, 5 Nov 2026, 10:31).
--
-- What needs repacking. Lines are matched before and after an edit by
-- product, SKU, variety and unit, and a matched line keeps its row and id.
--   * A new line, a changed quantity, or a removed line needs repacking.
--     A product, variety or unit change counts as removing the old line and
--     adding a new one. Only the changed lines lose their ticks.
--   * Prices, notes (order and line), customer details, delivery date and
--     time and the Sales Invoice number never clear a tick. A changed line
--     note on an order being packed or packed sets note_changed_at, so the
--     packing list can show "Note changed". Ticking the line again clears it.
--   * Removing a line that was already packed adds an item removal record.
--     Packing staff must confirm they took the item out of the prepared order.
--     Until every removal is confirmed and every line is ticked, the order
--     can't move to For delivery. It never moves there just because the
--     remaining lines are ticked.
--
-- Status changes.
--   * Packing (for_preparation): stays Packing.
--   * For delivery: goes back to Packing. The delivery record, DR number,
--     date, time, driver and route position are kept. When packing is done
--     again, the order returns to For delivery with the same delivery.
--   * Out for delivery: the server records departure as the delivery's status
--     'for_delivery' (update_delivery_status 'scheduled' -> 'for_delivery').
--     A packing edit is refused in that state. Other edits still save. The
--     server never infers departure from a driver being assigned, and never
--     pulls an order back off the truck.
--   * Completed and cancelled orders stay locked (approved exception).
--
-- Packing version. Every packing edit raises orders.packing_version.
-- Every tick and every completion must send the version the screen showed.
-- A missing version is refused with an update/refresh message and is never
-- replaced with the current one. A different version is refused with a
-- refresh message. Completion is checked again in the deliveries trigger, so
-- every route (online, offline sync, the old status action) needs it.
--
-- Locking. Edit, packing, departure and completion all lock the order row
-- before anything else changes, so they run one at a time for an order.

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

-- ---------------------------------------------------------------------------
-- 1. Columns and the removal record
-- ---------------------------------------------------------------------------

alter table public.orders add column if not exists packing_version integer not null default 1;
alter table public.order_items add column if not exists note_changed_at timestamptz;

create table if not exists public.order_item_removals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id),
  variety_id uuid references public.product_varieties(id),
  description text not null,
  quantity numeric(12, 3) not null,
  unit_of_measurement text not null,
  removed_by uuid references public.profiles(id),
  removed_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz
);
create index if not exists order_item_removals_open_idx on public.order_item_removals(order_id) where confirmed_at is null;
alter table public.order_item_removals enable row level security;
revoke all on table public.order_item_removals from anon, authenticated;
grant select on table public.order_item_removals to authenticated;
drop policy if exists "read_removals_with_order" on public.order_item_removals;
create policy "read_removals_with_order" on public.order_item_removals
  for select to authenticated using (public.can_read_order(order_id));

-- Packing is finished: every line ticked and every removal confirmed.
create or replace function public.order_fully_packed(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.order_items where order_id = p_order_id and preparation_status <> 'completed')
     and not exists (select 1 from public.order_item_removals where order_id = p_order_id and confirmed_at is null);
$$;
revoke all on function public.order_fully_packed(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The packing version check
-- ---------------------------------------------------------------------------

-- The caller has locked the order row. Refuses a missing or old version, and
-- records that this transaction checked it (read by the completion trigger).
create or replace function public.check_packing_version(p_order public.orders, p_version integer, p_errcode text default 'P0001')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_version is null then
    raise exception 'This app version can''t confirm the order''s latest items. Update the app, refresh, and try again.' using errcode = p_errcode;
  end if;
  if p_version <> p_order.packing_version then
    raise exception 'Order % changed after this screen was loaded. Refresh and check the items, then try again.', p_order.order_number using errcode = p_errcode;
  end if;
  perform set_config('meah.packing_version_checked', p_order.id::text || ':' || p_order.packing_version, true);
end;
$$;
revoke all on function public.check_packing_version(public.orders, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Guards on every route
-- ---------------------------------------------------------------------------

-- An order only becomes For delivery when packing is finished.
create or replace function public.orders_packed_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'for_delivery' and old.status is distinct from 'for_delivery' and public.is_app_call()
     and not public.order_fully_packed(new.id) then
    raise exception 'Finish packing first: every item must be ticked and every removed item confirmed.';
  end if;
  return new;
end;
$$;
revoke all on function public.orders_packed_rules() from public, anon, authenticated;
drop trigger if exists orders_packed_rules on public.orders;
create trigger orders_packed_rules before update of status on public.orders
  for each row execute procedure public.orders_packed_rules();

-- A delivery is completed only for a fully packed order, with the packing
-- version checked in this same transaction. This applies to every route.
create or replace function public.deliveries_complete_rules()
returns trigger language plpgsql set search_path = public as $$
declare
  v_order public.orders;
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and public.is_app_call() then
    if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[])
       and new.assigned_driver_id is distinct from auth.uid() then
      raise exception 'Only the assigned driver, the office or an administrator can mark this delivery delivered' using errcode = '42501';
    end if;
    select * into v_order from public.orders where id = new.order_id for update;
    if v_order.status = 'for_preparation' then
      raise exception 'This order is being repacked after a change. Mark it delivered once packing is finished.';
    end if;
    -- For delivery is only reached when packing is finished (orders_packed_rules),
    -- and any packing edit moves the order back to Packing.
    if v_order.status <> 'for_delivery' then
      raise exception 'This order is not packed yet, so it cannot be marked delivered.';
    end if;
    if coalesce(current_setting('meah.packing_version_checked', true), '') <> v_order.id::text || ':' || v_order.packing_version then
      raise exception 'This app version can''t confirm the order''s latest items. Update the app, refresh, and try again.';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Edit order: keep lines, untick only what changed
-- ---------------------------------------------------------------------------

create or replace function public.edit_order_with_items(p_order_id uuid, p_order jsonb, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
  v_delivery public.deliveries;
  v_customer uuid;
  v_same_customer boolean;
  v_packing boolean;
  v_item jsonb;
  v_line public.order_items;
  v_match uuid;
  v_kept uuid[] := '{}';
  v_product_id uuid;
  v_sku_id uuid;
  v_variety_id uuid;
  v_unit text;
  v_qty numeric;
  v_notes text;
  v_price numeric(12, 2);
  v_cost numeric(12, 2);
  v_before jsonb;
  v_after jsonb;
  v_subtotal numeric;
  v_changed jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_removed jsonb := '[]'::jsonb;
  v_notes_changed jsonb := '[]'::jsonb;
  v_repack boolean := false;
  v_back_to_packing boolean := false;
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

  -- Order first, then its open delivery: the same order completion,
  -- departure and packing use.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status in ('completed', 'cancelled') then raise exception 'Completed and cancelled orders can''t be edited'; end if;
  select * into v_delivery from public.deliveries
    where order_id = p_order_id and status in ('scheduled', 'for_delivery') for update;
  v_customer := (p_order->>'customer_id')::uuid;
  if not exists(select 1 from public.customers where id = v_customer and status = 'active') then raise exception 'Selected customer is unavailable'; end if;
  v_same_customer := v_order.customer_id = v_customer;
  v_packing := v_order.status in ('for_preparation', 'for_delivery');

  select jsonb_build_object(
    'customer_id', o.customer_id,
    'requested_delivery_date', o.requested_delivery_date,
    'notes', o.notes,
    'items', coalesce(jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'product_sku_id', oi.product_sku_id, 'variety_id', oi.variety_id, 'quantity', oi.quantity, 'unit_of_measurement', oi.unit_of_measurement, 'unit_price', oi.unit_price, 'notes', oi.notes)) filter (where oi.id is not null), '[]'::jsonb)
  ) into v_before
  from public.orders o left join public.order_items oi on oi.order_id = o.id
  where o.id = p_order_id group by o.id;

  update public.orders set customer_id = v_customer, requested_delivery_date = (p_order->>'requested_delivery_date')::date, notes = nullif(trim(p_order->>'notes'), '') where id = p_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_sku_id := nullif(v_item->>'product_sku_id', '')::uuid;
    v_variety_id := nullif(v_item->>'variety_id', '')::uuid;
    v_unit := trim(coalesce(v_item->>'unit_of_measurement', ''));
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_notes := nullif(trim(v_item->>'notes'), '');
    if v_qty <= 0 or v_unit = '' then raise exception 'Every item needs a positive quantity and unit'; end if;
    if not exists(select 1 from public.products where id = v_product_id and status = 'active') then raise exception 'Selected product is unavailable'; end if;
    if v_sku_id is not null and not exists(select 1 from public.product_skus where id = v_sku_id and product_id = v_product_id and status = 'active') then raise exception 'Selected SKU does not belong to product'; end if;
    if v_variety_id is not null and not exists(select 1 from public.product_varieties where id = v_variety_id and product_id = v_product_id and status = 'active') then raise exception 'Selected variety does not belong to product'; end if;

    -- The same product, SKU, variety and unit keeps its line.
    select id into v_match from public.order_items oi
      where oi.order_id = p_order_id and not (oi.id = any(v_kept))
        and oi.product_id = v_product_id
        and oi.product_sku_id is not distinct from v_sku_id
        and oi.variety_id is not distinct from v_variety_id
        and oi.unit_of_measurement = v_unit
      order by oi.created_at, oi.id limit 1;

    v_price := null;
    v_cost := null;
    if v_match is null or not v_same_customer then
      select cp.selling_price into v_price from public.customer_pricing cp where cp.customer_id = v_customer and cp.product_id = v_product_id and (cp.product_sku_id is not distinct from v_sku_id) and cp.effective_from <= now() and (cp.effective_to is null or cp.effective_to > now()) order by cp.effective_from desc limit 1;
      if v_price is null then select ph.selling_price, ph.cost_price into v_price, v_cost from public.price_history ph where ph.product_id = v_product_id and (ph.product_sku_id is not distinct from v_sku_id) and ph.effective_from <= now() and (ph.effective_to is null or ph.effective_to > now()) order by ph.effective_from desc limit 1; end if;
      if v_price is null then raise exception 'No active price exists for selected product'; end if;
      if v_cost is null then select ph.cost_price into v_cost from public.price_history ph where ph.product_id = v_product_id and (ph.product_sku_id is not distinct from v_sku_id) and ph.effective_from <= now() and (ph.effective_to is null or ph.effective_to > now()) order by ph.effective_from desc limit 1; end if;
    end if;

    if v_match is not null then
      v_kept := v_kept || v_match;
      select * into v_line from public.order_items where id = v_match;
      if v_line.quantity <> v_qty then
        v_repack := true;
        v_changed := v_changed || jsonb_build_object('item_id', v_line.id, 'product_id', v_product_id, 'from_quantity', v_line.quantity, 'to_quantity', v_qty, 'unit', v_unit, 'was_packed', v_line.preparation_status = 'completed');
      end if;
      if v_packing and v_line.notes is distinct from v_notes then
        v_notes_changed := v_notes_changed || jsonb_build_object('item_id', v_line.id, 'from', v_line.notes, 'to', v_notes);
      end if;
      -- A changed quantity unticks the line (order_items_clear_packing_tick).
      update public.order_items set
          quantity = v_qty,
          notes = v_notes,
          note_changed_at = case when v_packing and v_line.notes is distinct from v_notes then now() else note_changed_at end,
          preparation_status = case when v_line.quantity <> v_qty and preparation_status <> 'completed' then 'pending' else preparation_status end,
          unit_price = case when v_same_customer then unit_price else v_price end,
          original_unit_price = case when v_same_customer then original_unit_price else v_price end,
          cost_price = case when v_same_customer then cost_price else coalesce(v_cost, 0) end,
          special_price = case when v_same_customer then special_price end,
          special_price_reason = case when v_same_customer then special_price_reason end,
          special_price_authorized_by = case when v_same_customer then special_price_authorized_by end,
          special_price_authorized_at = case when v_same_customer then special_price_authorized_at end
        where id = v_match;
    else
      insert into public.order_items(order_id, product_id, product_sku_id, variety_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price, notes)
      values (p_order_id, v_product_id, v_sku_id, v_variety_id, v_qty, v_unit, v_price, v_price, coalesce(v_cost, 0), v_notes)
      returning * into v_line;
      v_kept := v_kept || v_line.id;
      v_repack := true;
      v_added := v_added || jsonb_build_object('item_id', v_line.id, 'product_id', v_product_id, 'quantity', v_qty, 'unit', v_unit);
    end if;
  end loop;

  -- Lines left over were removed. A packed one must be taken out of the
  -- prepared order, and packing staff confirm that.
  for v_line in select * from public.order_items where order_id = p_order_id and not (id = any(v_kept)) loop
    v_repack := true;
    v_removed := v_removed || jsonb_build_object('item_id', v_line.id, 'product_id', v_line.product_id, 'quantity', v_line.quantity,
      'unit', v_line.unit_of_measurement, 'was_packed', v_line.preparation_status = 'completed');
    if v_packing and v_line.preparation_status = 'completed' then
      insert into public.order_item_removals(order_id, product_id, variety_id, description, quantity, unit_of_measurement, removed_by)
      select p_order_id, v_line.product_id, v_line.variety_id,
        coalesce(p.product_name, 'Item') || coalesce(' · ' || pv.variety_name, ''), v_line.quantity, v_line.unit_of_measurement, auth.uid()
      from public.products p left join public.product_varieties pv on pv.id = v_line.variety_id
      where p.id = v_line.product_id;
    end if;
    delete from public.order_items where id = v_line.id;
  end loop;

  if v_repack and v_delivery.status = 'for_delivery' then
    raise exception 'This order is already out for delivery, so its items can''t be changed. Change it after the delivery comes back.';
  end if;

  if v_repack and v_packing then
    update public.orders set packing_version = packing_version + 1 where id = p_order_id;
    if v_order.status = 'for_delivery' then
      v_back_to_packing := true;
      update public.orders set status = 'for_preparation' where id = p_order_id;
      insert into public.order_activity(order_id, user_id, action, details)
      values (p_order_id, auth.uid(), 'status_changed',
        jsonb_build_object('from_status', 'for_delivery', 'to_status', 'for_preparation', 'reason', 'repack_required', 'delivery_id', v_delivery.id));
    end if;
  end if;

  update public.deliveries set scheduled_date = (p_order->>'requested_delivery_date')::date
    where order_id = p_order_id and status in ('scheduled', 'for_delivery')
      and scheduled_date is distinct from (p_order->>'requested_delivery_date')::date;

  select * into v_order from public.orders where id = p_order_id;
  v_subtotal := public.order_subtotal(v_order);
  if v_order.discount_type = 'fixed' and v_order.discount_value > v_subtotal then
    raise exception 'The discount is more than the new subtotal of %. Lower or remove the discount first.', to_char(v_subtotal, 'FM999,999,990.00');
  end if;

  select jsonb_build_object('customer_id', o.customer_id, 'requested_delivery_date', o.requested_delivery_date, 'notes', o.notes, 'item_count', count(oi.id)) into v_after from public.orders o left join public.order_items oi on oi.order_id = o.id where o.id = p_order_id group by o.id;
  insert into public.order_activity(order_id, user_id, action, details) values (p_order_id, auth.uid(), 'order_edited', jsonb_build_object(
    'before', v_before, 'after', v_after, 'status', v_order.status,
    'repack_required', v_repack and v_packing, 'back_to_packing', v_back_to_packing, 'packing_version', v_order.packing_version,
    'changed_lines', v_changed, 'added_lines', v_added, 'removed_lines', v_removed, 'notes_changed', v_notes_changed));
end;
$$;

-- Variety changes are matched as a new line, but if one is ever updated in
-- place it unticks too.
drop trigger if exists order_items_clear_packing_tick on public.order_items;
do $$ begin perform pg_temp.patch_all('public.clear_packing_tick_on_line_change()'::regprocedure,
  '      or new.product_sku_id is distinct from old.product_sku_id',
  '      or new.product_sku_id is distinct from old.product_sku_id
      or new.variety_id is distinct from old.variety_id'); end $$;
create trigger order_items_clear_packing_tick before update of product_id, product_sku_id, variety_id, quantity, unit_of_measurement on public.order_items
  for each row execute procedure public.clear_packing_tick_on_line_change();

-- ---------------------------------------------------------------------------
-- 5. Packing ticks need the packing version
-- ---------------------------------------------------------------------------

create or replace function public.set_item_packed(p_item_id uuid, p_packed boolean, p_client_request_id uuid, p_packing_version integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_replay jsonb;
  v_order public.orders;
  v_order_id uuid;
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

  -- Lock the order first, then the line, and only then read the status.
  select order_id into v_order_id from public.order_items where id = p_item_id;
  if v_order_id is null then raise exception 'This item was removed from the order. Refresh the list.'; end if;
  select * into v_order from public.orders where id = v_order_id for update;
  if v_order.status <> 'for_preparation' then
    raise exception '%', public.packing_order_problem(v_order.status);
  end if;
  perform public.check_packing_version(v_order, p_packing_version);
  select preparation_status into v_previous from public.order_items where id = p_item_id for update;
  if v_previous is null then raise exception 'This item was removed from the order. Refresh the list.'; end if;

  if p_packed and v_previous <> 'completed' then
    update public.order_items
      set preparation_status = 'completed',
          preparation_started_by = coalesce(preparation_started_by, auth.uid()),
          preparation_started_at = coalesce(preparation_started_at, now()),
          prepared_by = auth.uid(),
          prepared_at = now(),
          note_changed_at = null
      where id = p_item_id;
    insert into public.order_activity(order_id, user_id, action, details)
    values (v_order_id, auth.uid(), 'preparation_status_changed',
      jsonb_build_object('item_id', p_item_id, 'from_status', v_previous, 'to_status', 'completed', 'packing_version', v_order.packing_version));

    if public.order_fully_packed(v_order_id) then
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
      jsonb_build_object('item_id', p_item_id, 'from_status', 'completed', 'to_status', 'in_progress', 'reason', 'unticked', 'packing_version', v_order.packing_version));
  end if;

  v_result := public.packing_progress(v_order_id) || jsonb_build_object('item_id', p_item_id, 'packed', p_packed);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.set_item_packed(uuid, boolean, uuid, integer) from public, anon;
grant execute on function public.set_item_packed(uuid, boolean, uuid, integer) to authenticated;

-- Older app versions send no packing version: refuse, never guess.
create or replace function public.set_item_packed(p_item_id uuid, p_packed boolean, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to pack orders' using errcode = '42501';
  end if;
  raise exception 'This app version can''t confirm the order''s latest items. Update the app, refresh, and try again.';
end;
$$;
create or replace function public.update_preparation_status(p_item_id uuid, p_status public.preparation_status, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to pack orders' using errcode = '42501';
  end if;
  raise exception 'This app version can''t confirm the order''s latest items. Update the app, refresh, and try again.';
end;
$$;

do $$ begin perform pg_temp.patch_all('public.offline_set_item_packed(uuid, boolean, uuid, jsonb)'::regprocedure,
  '  v_result := public.set_item_packed(p_item_id, p_packed, public.offline_inner_request_id(p_client_request_id));',
  '  -- The version the list showed when the tick was made, offline or not.
  if nullif(p_offline->>''packing_version'', '''') is null then
    raise exception ''This app version can''''t confirm the order''''s latest items. Update the app, refresh, and try again.'' using errcode = ''OFCON'';
  end if;
  if (select packing_version from public.orders where id = v_item.order_id) <> (p_offline->>''packing_version'')::integer then
    raise exception ''The order was changed after your list was last updated, so % was not ticked. Refresh and check it.'', coalesce(v_name, ''this item'') using errcode = ''OFCON'';
  end if;
  v_result := public.set_item_packed(p_item_id, p_packed, public.offline_inner_request_id(p_client_request_id), (p_offline->>''packing_version'')::integer);'); end $$;

-- Confirming a removed item was taken out of the prepared order.
create or replace function public.confirm_item_removed(p_removal_id uuid, p_packing_version integer, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_replay jsonb;
  v_removal public.order_item_removals;
  v_order public.orders;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to pack orders' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('confirm_item_removed', p_client_request_id, jsonb_build_object('removal_id', p_removal_id));
  if v_replay is not null then return v_replay; end if;

  select order_id into v_removal.order_id from public.order_item_removals where id = p_removal_id;
  if v_removal.order_id is null then raise exception 'Removed item not found. Refresh the list.'; end if;
  select * into v_order from public.orders where id = v_removal.order_id for update;
  if v_order.status <> 'for_preparation' then
    raise exception '%', coalesce(public.packing_order_problem(v_order.status), 'This order is not being packed.');
  end if;
  perform public.check_packing_version(v_order, p_packing_version);
  select * into v_removal from public.order_item_removals where id = p_removal_id for update;
  if v_removal.confirmed_at is null then
    update public.order_item_removals set confirmed_by = auth.uid(), confirmed_at = now() where id = p_removal_id;
    insert into public.order_activity(order_id, user_id, action, details)
    values (v_order.id, auth.uid(), 'removed_item_confirmed',
      jsonb_build_object('removal_id', p_removal_id, 'description', v_removal.description, 'quantity', v_removal.quantity,
        'unit', v_removal.unit_of_measurement, 'packing_version', v_order.packing_version));
    if public.order_fully_packed(v_order.id) then
      update public.orders set status = 'for_delivery' where id = v_order.id;
      insert into public.order_activity(order_id, user_id, action, details)
      values (v_order.id, auth.uid(), 'status_changed',
        jsonb_build_object('from_status', 'for_preparation', 'to_status', 'for_delivery', 'reason', 'all_preparation_tasks_completed'));
    end if;
  end if;

  v_result := public.packing_progress(v_order.id) || jsonb_build_object('removal_id', p_removal_id);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.confirm_item_removed(uuid, integer, uuid) from public, anon;
grant execute on function public.confirm_item_removed(uuid, integer, uuid) to authenticated;

create or replace function public.packing_progress(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'status', o.status,
    'packing_version', o.packing_version,
    'packed_count', (select count(*) from public.order_items i where i.order_id = o.id and i.preparation_status = 'completed'),
    'item_count', (select count(*) from public.order_items i where i.order_id = o.id),
    'removals_to_confirm', (select count(*) from public.order_item_removals r where r.order_id = o.id and r.confirmed_at is null))
  from public.orders o where o.id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- 6. Completion needs the packing version on every route
-- ---------------------------------------------------------------------------

create or replace function public.complete_delivery(p_delivery_id uuid, p_received_by text, p_client_request_id uuid, p_packing_version integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_replay jsonb;
  v_row public.deliveries;
  v_order public.orders;
  v_is_management boolean := public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]);
  v_received_by text := nullif(regexp_replace(trim(coalesce(p_received_by, '')), '\s+', ' ', 'g'), '');
  v_receipt jsonb;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'delivery_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to mark deliveries delivered' using errcode = '42501';
  end if;
  if length(v_received_by) > 80 then raise exception 'Keep the name to 80 characters or fewer'; end if;
  v_replay := public.begin_client_request('complete_delivery', p_client_request_id,
    jsonb_build_object('delivery_id', p_delivery_id, 'received_by', v_received_by));
  if v_replay is not null then return v_replay; end if;

  -- Order first, then delivery: the same order edit, packing and departure use.
  select o.* into v_order
  from public.orders o join public.deliveries d on d.order_id = o.id
  where d.id = p_delivery_id
  for update of o;
  select * into v_row from public.deliveries where id = p_delivery_id for update;
  if v_row.id is null then raise exception 'Delivery not found'; end if;
  if not v_is_management and v_row.assigned_driver_id is distinct from auth.uid() then
    raise exception 'You can only confirm your own stops' using errcode = '42501';
  end if;
  if v_row.status = 'completed' then raise exception 'This delivery is already marked delivered.'; end if;
  if v_row.status = 'cancelled' or v_order.status = 'cancelled' then
    raise exception 'This delivery was cancelled, so it cannot be marked delivered.';
  end if;
  if v_order.status = 'for_preparation' then
    raise exception 'This order is being repacked after a change. Mark it delivered once packing is finished.';
  end if;
  if v_order.status <> 'for_delivery' then
    raise exception 'This order is not packed yet, so it cannot be marked delivered.';
  end if;
  perform public.check_packing_version(v_order, p_packing_version);

  update public.deliveries
    set status = 'completed', completed_at = now(), received_by = v_received_by
    where id = p_delivery_id;
  insert into public.order_activity(order_id, user_id, action, details)
  values (v_row.order_id, auth.uid(), 'delivery_status_changed',
    jsonb_build_object('from_status', v_row.status, 'to_status', 'completed', 'delivery_id', p_delivery_id, 'packing_version', v_order.packing_version)
      || case when v_received_by is not null then jsonb_build_object('received_by', v_received_by) else '{}'::jsonb end);

  update public.orders set status = 'completed' where id = v_row.order_id;
  insert into public.order_activity(order_id, user_id, action, details)
  values (v_row.order_id, auth.uid(), 'status_changed',
    jsonb_build_object('from_status', 'for_delivery', 'to_status', 'completed', 'delivery_id', p_delivery_id));

  v_receipt := public.issue_receipt_for(v_row.order_id);
  v_result := jsonb_build_object('delivery_id', p_delivery_id, 'order_id', v_row.order_id, 'status', 'completed',
    'received_by', v_received_by, 'dr_label', v_receipt->>'dr_label');
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.complete_delivery(uuid, text, uuid, integer) from public, anon;
grant execute on function public.complete_delivery(uuid, text, uuid, integer) to authenticated;

create or replace function public.complete_delivery(p_delivery_id uuid, p_received_by text, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'delivery_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to mark deliveries delivered' using errcode = '42501';
  end if;
  raise exception 'This app version can''t confirm the order''s latest items. Update the app, refresh, and try again.';
end;
$$;

do $$ begin perform pg_temp.patch_all('public.offline_complete_delivery(uuid, text, uuid, jsonb)'::regprocedure,
  '  v_result := public.complete_delivery(p_delivery_id, p_received_by, public.offline_inner_request_id(p_client_request_id));',
  '  -- The version the stop showed when it was marked delivered, offline or not.
  if nullif(p_offline->>''packing_version'', '''') is null then
    raise exception ''This app version can''''t confirm the order''''s latest items. Update the app, refresh, and try again.'' using errcode = ''OFCON'';
  end if;
  if v_order.status = ''for_preparation'' then
    raise exception ''The order was changed and is being repacked, so it was not marked delivered. Check it with the office.'' using errcode = ''OFCON'';
  end if;
  if v_order.packing_version <> (p_offline->>''packing_version'')::integer then
    raise exception ''The order''''s items were changed after this was recorded, so it was not marked delivered. Open it, check the items, and mark it again.'' using errcode = ''OFCON'';
  end if;
  v_result := public.complete_delivery(p_delivery_id, p_received_by, public.offline_inner_request_id(p_client_request_id), (p_offline->>''packing_version'')::integer);'); end $$;

-- Lock the order before reading it, like the other routes.
do $$ begin perform pg_temp.patch_all('public.offline_complete_delivery(uuid, text, uuid, jsonb)'::regprocedure,
  '  select * into v_order from public.orders where id = v_row.order_id;',
  '  select * into v_order from public.orders where id = v_row.order_id for update;'); end $$;

-- The old status action can no longer complete (it sends no version); the
-- trigger refuses it too. Departure keeps working and locks the order first.
do $$ begin perform pg_temp.patch_all('public.update_delivery_status(uuid, public.delivery_status, text)'::regprocedure,
  '  elsif v_current = ''for_delivery'' and p_status = ''completed'' then
    if v_order_status <> ''for_delivery'' then
      raise exception ''Only orders For Delivery can be completed'';
    end if;',
  '  elsif p_status = ''completed'' then
    raise exception ''This app version can''''t confirm the order''''s latest items. Update the app, refresh, and try again.'';'); end $$;
do $$ begin perform pg_temp.patch_all('public.update_delivery_status(uuid, public.delivery_status, text)'::regprocedure,
  '  select d.order_id, d.status, o.status
    into v_order_id, v_current, v_order_status
  from public.deliveries d
  join public.orders o on o.id = d.order_id
  where d.id = p_delivery_id
  for update of d, o;',
  '  select o.status into v_order_status
  from public.orders o join public.deliveries d on d.order_id = o.id
  where d.id = p_delivery_id
  for update of o;
  select d.order_id, d.status into v_order_id, v_current
  from public.deliveries d where d.id = p_delivery_id for update;'); end $$;

-- ---------------------------------------------------------------------------
-- 7. A repack can't be stopped: its delivery is already booked
-- ---------------------------------------------------------------------------
-- Moving it back to Confirmed would leave a booked stop for an unconfirmed
-- order. The changed items are packed instead and the order goes back to For
-- delivery.
do $$ begin perform pg_temp.patch_all('public.cancel_packing(uuid, uuid)'::regprocedure,
  '  update public.orders set status = ''confirmed'' where id = p_order_id;',
  '  if exists(select 1 from public.deliveries where order_id = p_order_id and status in (''scheduled'', ''for_delivery'')) then
    raise exception ''This order was changed after packing and its delivery is already booked, so packing can''''t be stopped. Pack the changed items instead.'';
  end if;
  update public.orders set status = ''confirmed'' where id = p_order_id;'); end $$;
