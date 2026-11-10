-- Phase 6 (rollout tasks 6.1 to 6.5): Deliveries and the delivery receipt.
--
-- Additive. The old app keeps calling update_delivery_status, create_delivery
-- and reschedule_delivery, which are unchanged. Rollback: drop the functions,
-- the delivery_receipts table, its sequence and deliveries.route_position.
--
-- Decisions (Jac 2026-11-03):
--   * Letter receipt layout first (D-D1).
--   * Order numbers stay ORD-####. An issued receipt gets its own DR number
--     (D-D2), which never changes; a reprint shows the receipt exactly as it
--     was issued.
--   * Delivery staff reorder and complete only their own stops.
--     Administrators and administrative staff assign and reassign drivers.
--   * A stop with no delivery time shows "Not specified" and is left out of
--     the overlap warning (the app works the warning out).

-- ---------------------------------------------------------------------------
-- 1. Route order (task 6.2)
-- ---------------------------------------------------------------------------
-- A route is one driver's open stops on one day (or the day's unassigned
-- stops). route_position is the stop's place in it; stops without one come
-- after, by time.

alter table public.deliveries add column if not exists route_position integer;
alter table public.deliveries drop constraint if exists deliveries_route_position_positive;
alter table public.deliveries add constraint deliveries_route_position_positive check (route_position is null or route_position > 0);
create index if not exists deliveries_route_idx on public.deliveries (scheduled_date, assigned_driver_id, route_position);


-- Saves the order of one route. The app sends every stop it showed, in the
-- new order. If a stop was added to or taken off the route since then (for
-- example a driver was reassigned on another phone), nothing is saved and the
-- app reloads, so one person's edit never silently undoes another's.
create or replace function public.reorder_route(
  p_date date,
  p_driver_id uuid,
  p_delivery_ids uuid[],
  p_client_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_replay jsonb;
  v_is_management boolean := public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]);
  v_current uuid[];
  v_result jsonb;
begin
  if not v_is_management then
    if not public.has_app_role(array['delivery_staff']::public.profile_role[]) then
      raise exception 'You do not have permission to change routes' using errcode = '42501';
    end if;
    if p_driver_id is distinct from auth.uid() then
      raise exception 'You can only reorder your own stops' using errcode = '42501';
    end if;
  end if;
  if p_date is null then raise exception 'Choose the route''s day'; end if;
  if coalesce(cardinality(p_delivery_ids), 0) = 0 then raise exception 'The route has no stops'; end if;
  if cardinality(p_delivery_ids) <> (select count(distinct x) from unnest(p_delivery_ids) x) then
    raise exception 'A stop is listed twice';
  end if;
  v_replay := public.begin_client_request('reorder_route', p_client_request_id,
    jsonb_build_object('date', p_date, 'driver_id', p_driver_id, 'ids', to_jsonb(p_delivery_ids)));
  if v_replay is not null then return v_replay; end if;

  -- Lock the route's stops in a fixed order, then compare.
  select coalesce(array_agg(id order by id), '{}') into v_current
  from (
    select id from public.deliveries
    where scheduled_date = p_date
      and assigned_driver_id is not distinct from p_driver_id
      and status in ('scheduled', 'for_delivery')
    order by id
    for update
  ) locked;
  if v_current <> (select array_agg(x order by x) from unnest(p_delivery_ids) x) then
    raise exception 'This route changed while you were editing it. It has been reloaded: check the order and save again.';
  end if;

  update public.deliveries d
    set route_position = s.position
    from unnest(p_delivery_ids) with ordinality as s(id, position)
    where d.id = s.id and d.route_position is distinct from s.position::integer;

  insert into public.order_activity(order_id, user_id, action, details)
  select d.order_id, auth.uid(), 'route_reordered',
    jsonb_build_object('delivery_id', d.id, 'route_date', p_date, 'driver_id', p_driver_id, 'position', s.position)
  from unnest(p_delivery_ids) with ordinality as s(id, position)
  join public.deliveries d on d.id = s.id;

  v_result := jsonb_build_object('date', p_date, 'driver_id', p_driver_id, 'ids', to_jsonb(p_delivery_ids));
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Assigning a driver (task 6.3)
-- ---------------------------------------------------------------------------
-- The stop goes to the end of its new route. p_driver_id null takes the
-- driver off (the stop becomes unassigned).

create or replace function public.assign_delivery_driver(p_delivery_id uuid, p_driver_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_replay jsonb;
  v_row public.deliveries;
  v_position integer;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can assign drivers' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('assign_delivery_driver', p_client_request_id,
    jsonb_build_object('delivery_id', p_delivery_id, 'driver_id', p_driver_id));
  if v_replay is not null then return v_replay; end if;

  select * into v_row from public.deliveries where id = p_delivery_id for update;
  if v_row.id is null then raise exception 'Delivery not found'; end if;
  if v_row.status not in ('scheduled', 'for_delivery') then
    raise exception 'This delivery is already %, so its driver can no longer change.',
      case v_row.status when 'completed' then 'delivered' else 'cancelled' end;
  end if;
  perform public.validate_delivery_driver(p_driver_id);

  if v_row.assigned_driver_id is distinct from p_driver_id then
    select greatest(coalesce(max(route_position), 0), count(*)) + 1 into v_position
    from public.deliveries
    where scheduled_date = v_row.scheduled_date
      and assigned_driver_id is not distinct from p_driver_id
      and status in ('scheduled', 'for_delivery');
    update public.deliveries set assigned_driver_id = p_driver_id, route_position = v_position where id = p_delivery_id;
    insert into public.order_activity(order_id, user_id, action, details)
    values (v_row.order_id, auth.uid(), 'driver_assigned',
      jsonb_build_object('delivery_id', p_delivery_id, 'from_driver_id', v_row.assigned_driver_id, 'to_driver_id', p_driver_id));
  end if;

  v_result := jsonb_build_object('delivery_id', p_delivery_id, 'driver_id', p_driver_id);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Delivery receipts (task 6.5)
-- ---------------------------------------------------------------------------
-- One receipt per order, numbered from its own sequence. Its contents are
-- saved when it is issued, so a reprint shows exactly what was handed over.
-- PROVISIONAL: numbering starts at 1. If MEAH wants to continue from its
-- paper receipts, set the sequence before go-live:
--   select setval('public.delivery_receipt_number_seq', <last paper number>);

create sequence if not exists public.delivery_receipt_number_seq start 1;

create table if not exists public.delivery_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  dr_number integer not null unique default nextval('public.delivery_receipt_number_seq'),
  content jsonb not null,
  issued_by uuid not null references public.profiles(id) on delete restrict,
  issued_at timestamptz not null default now()
);
alter table public.delivery_receipts enable row level security;
revoke all on public.delivery_receipts from anon, authenticated;
grant select on public.delivery_receipts to authenticated;
drop policy if exists "staff_read_delivery_receipts" on public.delivery_receipts;
create policy "staff_read_delivery_receipts" on public.delivery_receipts for select to authenticated using (
  public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[])
  or (public.has_app_role(array['delivery_staff']::public.profile_role[])
      and exists (select 1 from public.deliveries d where d.order_id = delivery_receipts.order_id and d.assigned_driver_id = auth.uid()))
);
-- Receipts are never edited or deleted; only issue_delivery_receipt adds them.
create or replace function public.delivery_receipts_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Delivery receipts cannot be changed once issued';
end;
$$;
drop trigger if exists delivery_receipts_no_change on public.delivery_receipts;
create trigger delivery_receipts_no_change before update or delete on public.delivery_receipts
  for each row execute function public.delivery_receipts_immutable();

create or replace function public.delivery_receipt_json(p_receipt public.delivery_receipts)
returns jsonb
language sql stable
as $$
  select p_receipt.content || jsonb_build_object(
    'receipt_id', p_receipt.id,
    'order_id', p_receipt.order_id,
    'dr_number', p_receipt.dr_number,
    'dr_label', 'DR-' || lpad(p_receipt.dr_number::text, 4, '0'),
    'issued_at', p_receipt.issued_at);
$$;
revoke all on function public.delivery_receipt_json(public.delivery_receipts) from public, anon, authenticated;

-- Internal: issue (or return) the receipt for an order already checked and locked.
create or replace function public.issue_receipt_for(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_receipt public.delivery_receipts;
  v_order public.orders;
  v_content jsonb;
begin
  select * into v_receipt from public.delivery_receipts where order_id = p_order_id;
  if found then return public.delivery_receipt_json(v_receipt); end if;

  select * into v_order from public.orders where id = p_order_id;
  select jsonb_build_object(
      'layout', 'letter',
      'company_name', 'MEAH AGRICULTURAL PRODUCTS TRADING',
      'company_address', '162 F. Benitez St., Brgy. Pasadena, San Juan 1500',
      'company_phone', '0966-168-1602',
      'order_number', v_order.order_number,
      'customer_name', c.business_name,
      'delivery_address', c.delivery_address,
      'delivery_date', coalesce((select d.scheduled_date from public.deliveries d where d.order_id = v_order.id), v_order.requested_delivery_date),
      'sales_invoice_number', v_order.sales_invoice_number,
      'issued_by_name', coalesce(nullif(trim(p.full_name), ''), p.email),
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'quantity', i.quantity,
            'unit', i.unit_of_measurement,
            'description', pr.product_name || coalesce(' (' || v.variety_name || ')', ''),
            'unit_price', i.unit_price,
            'amount', i.line_total) order by i.created_at, i.id)
        from public.order_items i
        join public.products pr on pr.id = i.product_id
        left join public.product_varieties v on v.id = i.variety_id
        where i.order_id = v_order.id), '[]'::jsonb))
    || public.order_money(v_order)
  into v_content
  from public.customers c, public.profiles p
  where c.id = v_order.customer_id and p.id = auth.uid();

  insert into public.delivery_receipts (order_id, content, issued_by)
  values (p_order_id, v_content, auth.uid())
  returning * into v_receipt;
  insert into public.order_activity(order_id, user_id, action, details)
  values (p_order_id, auth.uid(), 'receipt_issued',
    jsonb_build_object('receipt_id', v_receipt.id, 'dr_number', v_receipt.dr_number));
  return public.delivery_receipt_json(v_receipt);
end;
$$;
revoke all on function public.issue_receipt_for(uuid) from public, anon, authenticated;

-- Issue a receipt from Order detail, or return the one already issued. An
-- order gets a receipt once it is packed or being packed (so the driver can
-- carry it) and keeps it after delivery. Asking again never makes a second
-- receipt or a new number.
create or replace function public.issue_delivery_receipt(p_order_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_replay jsonb;
  v_status public.order_status;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can issue delivery receipts' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('issue_delivery_receipt', p_client_request_id, jsonb_build_object('order_id', p_order_id));
  if v_replay is not null then return v_replay; end if;

  select status into v_status from public.orders where id = p_order_id for update;
  if v_status is null then raise exception 'Order not found'; end if;
  if v_status not in ('for_preparation', 'for_delivery', 'completed') then
    raise exception '%', case v_status
      when 'cancelled' then 'This order was cancelled, so it has no delivery receipt.'
      else 'A delivery receipt can be issued once the order is being packed.' end;
  end if;

  v_result := public.issue_receipt_for(p_order_id);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Confirming a delivery (task 6.4)
-- ---------------------------------------------------------------------------
-- One step for "Mark delivered": the delivery and the order become completed,
-- who received it is saved, and the receipt is issued if it wasn't already,
-- all in one transaction. A retry with the same request id returns the first
-- result; a second confirmation with a new id is refused.

create or replace function public.complete_delivery(p_delivery_id uuid, p_received_by text, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_replay jsonb;
  v_row public.deliveries;
  v_order_status public.order_status;
  v_is_management boolean := public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]);
  v_received_by text := nullif(regexp_replace(trim(coalesce(p_received_by, '')), '\s+', ' ', 'g'), '');
  v_receipt jsonb;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'delivery_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to confirm deliveries' using errcode = '42501';
  end if;
  if length(v_received_by) > 80 then raise exception 'Keep the name to 80 characters or fewer'; end if;
  v_replay := public.begin_client_request('complete_delivery', p_client_request_id,
    jsonb_build_object('delivery_id', p_delivery_id, 'received_by', v_received_by));
  if v_replay is not null then return v_replay; end if;

  -- Order first, then delivery: the same order the status RPCs use.
  select o.status into v_order_status
  from public.orders o join public.deliveries d on d.order_id = o.id
  where d.id = p_delivery_id
  for update of o;
  select * into v_row from public.deliveries where id = p_delivery_id for update;
  if v_row.id is null then raise exception 'Delivery not found'; end if;
  if not v_is_management and v_row.assigned_driver_id is distinct from auth.uid() then
    raise exception 'You can only confirm your own stops' using errcode = '42501';
  end if;
  if v_row.status = 'completed' then raise exception 'This delivery is already marked delivered.'; end if;
  if v_row.status = 'cancelled' or v_order_status = 'cancelled' then
    raise exception 'This delivery was cancelled, so it cannot be marked delivered.';
  end if;
  if v_order_status <> 'for_delivery' then
    raise exception 'This order is not packed yet, so it cannot be marked delivered.';
  end if;

  update public.deliveries
    set status = 'completed', completed_at = now(), received_by = v_received_by
    where id = p_delivery_id;
  insert into public.order_activity(order_id, user_id, action, details)
  values (v_row.order_id, auth.uid(), 'delivery_status_changed',
    jsonb_build_object('from_status', v_row.status, 'to_status', 'completed', 'delivery_id', p_delivery_id)
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

revoke all on function public.reorder_route(date, uuid, uuid[], uuid) from public, anon;
revoke all on function public.assign_delivery_driver(uuid, uuid, uuid) from public, anon;
revoke all on function public.issue_delivery_receipt(uuid, uuid) from public, anon;
revoke all on function public.complete_delivery(uuid, text, uuid) from public, anon;
grant execute on function public.reorder_route(date, uuid, uuid[], uuid) to authenticated;
grant execute on function public.assign_delivery_driver(uuid, uuid, uuid) to authenticated;
grant execute on function public.issue_delivery_receipt(uuid, uuid) to authenticated;
grant execute on function public.complete_delivery(uuid, text, uuid) to authenticated;

-- Drivers listed in Assign driver, with today's open stop count. The profiles
-- policy already lets administrative staff see active delivery staff.
create or replace function public.get_delivery_drivers(p_date date)
returns table(id uuid, full_name text, open_stops bigint)
language sql stable security definer set search_path = public
as $$
  select p.id, coalesce(nullif(trim(p.full_name), ''), p.email),
    (select count(*) from public.deliveries d where d.assigned_driver_id = p.id and d.scheduled_date = p_date and d.status in ('scheduled', 'for_delivery'))
  from public.profiles p
  where p.role = 'delivery_staff' and p.status = 'active'
    and public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[])
  order by 2;
$$;
revoke all on function public.get_delivery_drivers(date) from public, anon;
grant execute on function public.get_delivery_drivers(date) to authenticated;
