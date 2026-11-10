-- Phase 4 (rollout tasks 4.3 to 4.5): New order with delivery time, order
-- source, SI#, discount and retry protection, plus the admin lists of
-- delivery times and order sources.
--
-- Additive. The old app keeps calling create_order_with_items, which is
-- unchanged. Rollback: drop the functions below and the two time columns.
--
-- Stock and verification (PROVISIONAL, Jac 2026-11-03, until D-S1 to D-S3 are
-- decided):
--   * An order may ask for more than the stock on hand, or for a product that
--     is out of stock. The app shows a clear warning; the server does not
--     refuse it.
--   * Orders never reserve or deduct stock. Inventory changes only through the
--     manual adjustment screen (adjust_inventory), as today.
--   * Every new order starts For verification, whether or not Needs checking
--     is on. Needs checking only adds the flag and its note.

-- ---------------------------------------------------------------------------
-- 1. Delivery time on the order
-- ---------------------------------------------------------------------------
-- Figma step 3 asks for a start time and an optional end time. An admin's
-- saved delivery time (delivery_time_slots) fills both in one tap; the order
-- keeps the times it was taken with, so later changes to the list don't alter
-- old orders.

alter table public.orders
  add column if not exists delivery_time_start time,
  add column if not exists delivery_time_end time;
alter table public.orders drop constraint if exists orders_delivery_time_window;
alter table public.orders add constraint orders_delivery_time_window check (
  (delivery_time_end is null or delivery_time_start is not null)
  and (delivery_time_end is null or delivery_time_end > delivery_time_start)
);

-- ---------------------------------------------------------------------------
-- 2. Creating an order (task 4.4)
-- ---------------------------------------------------------------------------
-- One call does everything step 3 asks for, in one transaction: the order and
-- its lines (priced by create_order_with_items, as before), the delivery time,
-- the source, the SI# and the discount. If any part is refused, nothing is
-- saved. A retry with the same client_request_id returns the first order
-- instead of creating a second one.

create or replace function public.create_order(
  p_order jsonb,
  p_items jsonb,
  p_client_request_id uuid,
  p_source_order_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_replay jsonb;
  v_order jsonb := coalesce(p_order, '{}'::jsonb);
  v_source public.order_sources;
  v_slot public.delivery_time_slots;
  v_start time;
  v_end time;
  v_si text := nullif(trim(coalesce(p_order->>'sales_invoice_number', '')), '');
  v_discount jsonb := p_order->'discount';
  v_order_id uuid;
  v_row public.orders;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to create orders' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('create_order', p_client_request_id,
    jsonb_build_object('order', p_order, 'items', p_items, 'source_order_id', p_source_order_id));
  if v_replay is not null then return v_replay; end if;

  -- Where the order came from. The old enum column is still filled in for the
  -- old app: a source added by an admin is stored there as 'other'.
  if nullif(p_order->>'order_source_id', '') is null then
    raise exception 'Choose where the order came from';
  end if;
  select * into v_source from public.order_sources where id = (p_order->>'order_source_id')::uuid;
  if not found or not v_source.is_active then
    raise exception 'That order source is no longer offered. Choose another.';
  end if;
  v_order := v_order || jsonb_build_object('order_source', coalesce(v_source.code, 'other'));

  -- Delivery time: a saved time, or a start with an optional end.
  if nullif(p_order->>'delivery_time_slot_id', '') is not null then
    select * into v_slot from public.delivery_time_slots where id = (p_order->>'delivery_time_slot_id')::uuid;
    if not found or not v_slot.is_active then
      raise exception 'That delivery time is no longer offered. Choose another.';
    end if;
  end if;
  v_start := coalesce(nullif(p_order->>'delivery_time_start', '')::time, v_slot.starts_at);
  v_end := coalesce(nullif(p_order->>'delivery_time_end', '')::time, case when nullif(p_order->>'delivery_time_start', '') is null then v_slot.ends_at end);
  if v_end is not null and v_start is null then
    raise exception 'Add a start time before an end time';
  end if;
  if v_end is not null and v_end <= v_start then
    raise exception 'The end time must be after the start time';
  end if;

  if p_source_order_id is not null then
    v_order_id := public.create_duplicate_order_with_items(p_source_order_id, v_order, p_items);
  else
    v_order_id := public.create_order_with_items(v_order, p_items);
  end if;

  update public.orders
    set order_source_id = v_source.id,
        delivery_time_slot_id = v_slot.id,
        delivery_time_start = v_start,
        delivery_time_end = v_end
    where id = v_order_id;

  -- Same rules, checks and activity entries as on Order detail.
  if v_si is not null then
    perform public.set_sales_invoice_number(v_order_id, v_si, null, gen_random_uuid());
  end if;
  if v_discount is not null and jsonb_typeof(v_discount) = 'object' then
    perform public.apply_order_discount(
      v_order_id,
      v_discount->>'type',
      nullif(v_discount->>'value', '')::numeric,
      v_discount->>'reason',
      gen_random_uuid());
  end if;

  select * into v_row from public.orders where id = v_order_id;
  v_result := public.order_money(v_row) || jsonb_build_object('order_number', v_row.order_number, 'status', v_row.status);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.create_order(jsonb, jsonb, uuid, uuid) from public, anon;
grant execute on function public.create_order(jsonb, jsonb, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Manage order sources and delivery times (task 4.5, administrators)
-- ---------------------------------------------------------------------------
-- Removing hides an entry from new orders; it is never deleted, so old orders
-- keep showing the source and time they were taken with.

create or replace function public.add_order_source(p_label text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_label text := regexp_replace(trim(coalesce(p_label, '')), '\s+', ' ', 'g');
  v_row public.order_sources;
begin
  if not public.is_active_administrator() then
    raise exception 'Only an administrator can change order sources' using errcode = '42501';
  end if;
  if v_label = '' then raise exception 'Enter a name for the source'; end if;
  if length(v_label) > 60 then raise exception 'Keep the name to 60 characters or fewer'; end if;
  select * into v_row from public.order_sources where lower(label) = lower(v_label);
  if found then
    if v_row.is_active then raise exception '% is already on the list', v_row.label; end if;
    update public.order_sources set is_active = true where id = v_row.id;
    return v_row.id;
  end if;
  insert into public.order_sources (label, sort_order)
  values (v_label, coalesce((select max(sort_order) from public.order_sources), 0) + 1)
  returning id into v_row.id;
  return v_row.id;
end;
$$;

create or replace function public.remove_order_source(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_active_administrator() then
    raise exception 'Only an administrator can change order sources' using errcode = '42501';
  end if;
  perform 1 from public.order_sources where id = p_id and is_active for update;
  if not found then raise exception 'Order source not found'; end if;
  if (select count(*) from public.order_sources where is_active) <= 1 then
    raise exception 'Keep at least one order source';
  end if;
  update public.order_sources set is_active = false where id = p_id;
end;
$$;

create or replace function public.add_delivery_time_slot(p_starts_at time, p_ends_at time default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_label text;
begin
  if not public.is_active_administrator() then
    raise exception 'Only an administrator can change delivery times' using errcode = '42501';
  end if;
  if p_starts_at is null then raise exception 'Choose a start time'; end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'The end time must be after the start time';
  end if;
  v_label := trim(to_char(p_starts_at, 'FMHH12:MI AM'))
    || coalesce(' – ' || trim(to_char(p_ends_at, 'FMHH12:MI AM')), '');
  select id into v_id from public.delivery_time_slots
    where starts_at = p_starts_at and ends_at is not distinct from p_ends_at;
  if v_id is not null then
    if exists (select 1 from public.delivery_time_slots where id = v_id and is_active) then
      raise exception '% is already on the list', v_label;
    end if;
    update public.delivery_time_slots set is_active = true where id = v_id;
    return v_id;
  end if;
  insert into public.delivery_time_slots (label, starts_at, ends_at, sort_order)
  values (v_label, p_starts_at, p_ends_at, extract(epoch from p_starts_at)::integer / 60)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.remove_delivery_time_slot(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_active_administrator() then
    raise exception 'Only an administrator can change delivery times' using errcode = '42501';
  end if;
  update public.delivery_time_slots set is_active = false where id = p_id and is_active;
  if not found then raise exception 'Delivery time not found'; end if;
end;
$$;

revoke all on function public.add_order_source(text) from public, anon;
revoke all on function public.remove_order_source(uuid) from public, anon;
revoke all on function public.add_delivery_time_slot(time, time) from public, anon;
revoke all on function public.remove_delivery_time_slot(uuid) from public, anon;
grant execute on function public.add_order_source(text) to authenticated;
grant execute on function public.remove_order_source(uuid) to authenticated;
grant execute on function public.add_delivery_time_slot(time, time) to authenticated;
grant execute on function public.remove_delivery_time_slot(uuid) to authenticated;

-- The list of delivery times starts empty: admins add the ones MEAH offers.
