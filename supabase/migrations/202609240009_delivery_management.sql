-- MEAH delivery management workflow. Apply after Part 1-2 hardening.

-- Administrative staff may select active delivery personnel when assigning a
-- driver, but cannot browse unrelated personnel profiles.
drop policy if exists "profiles_select_self_or_administrator" on public.profiles;
create policy "profiles_select_self_admin_or_active_drivers"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_active_administrator()
    or (
      public.has_app_role(array['administrative_staff']::public.profile_role[])
      and role = 'delivery_staff'
      and status = 'active'
    )
  );

-- Delivery mutations must use the audited RPCs below. This removes the
-- previous direct-update path that could bypass lifecycle validation.
drop policy if exists "management_write_deliveries" on public.deliveries;
drop policy if exists "driver_update_assigned_delivery" on public.deliveries;
revoke insert, update on public.deliveries from authenticated;

create or replace function public.validate_delivery_driver(p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_driver_id is not null and not exists (
    select 1 from public.profiles
    where id = p_driver_id
      and role = 'delivery_staff'
      and status = 'active'
  ) then
    raise exception 'Assigned driver must be an active delivery staff member';
  end if;
end;
$$;
revoke all on function public.validate_delivery_driver(uuid) from public;

create or replace function public.create_delivery(
  p_order_id uuid,
  p_scheduled_date date,
  p_scheduled_time time default null,
  p_assigned_driver_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery_id uuid;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to create deliveries';
  end if;
  if p_scheduled_date is null then
    raise exception 'A scheduled delivery date is required';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id and status = 'for_delivery') then
    raise exception 'A delivery can be created only for an order ready for delivery';
  end if;
  if exists (select 1 from public.deliveries where order_id = p_order_id) then
    raise exception 'This order already has a delivery record';
  end if;

  perform public.validate_delivery_driver(p_assigned_driver_id);
  insert into public.deliveries(order_id, assigned_driver_id, scheduled_date, scheduled_time, notes)
  values (p_order_id, p_assigned_driver_id, p_scheduled_date, p_scheduled_time, nullif(trim(p_notes), ''))
  returning id into v_delivery_id;

  insert into public.order_activity(order_id, user_id, action, details)
  values (
    p_order_id,
    auth.uid(),
    'delivery_created',
    jsonb_build_object('delivery_id', v_delivery_id, 'scheduled_date', p_scheduled_date, 'scheduled_time', p_scheduled_time, 'assigned_driver_id', p_assigned_driver_id)
  );
  return v_delivery_id;
end;
$$;
revoke all on function public.create_delivery(uuid, date, time, uuid, text) from public;
grant execute on function public.create_delivery(uuid, date, time, uuid, text) to authenticated;

create or replace function public.reschedule_delivery(
  p_delivery_id uuid,
  p_scheduled_date date,
  p_scheduled_time time default null,
  p_assigned_driver_id uuid default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_status public.delivery_status;
  v_old_date date;
  v_old_time time;
  v_old_driver uuid;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to reschedule deliveries';
  end if;
  if p_scheduled_date is null then
    raise exception 'A scheduled delivery date is required';
  end if;

  select order_id, status, scheduled_date, scheduled_time, assigned_driver_id
    into v_order_id, v_status, v_old_date, v_old_time, v_old_driver
  from public.deliveries
  where id = p_delivery_id
  for update;
  if v_order_id is null then raise exception 'Delivery not found'; end if;
  if v_status in ('completed', 'cancelled') then raise exception 'Completed or cancelled deliveries cannot be rescheduled'; end if;

  perform public.validate_delivery_driver(p_assigned_driver_id);
  update public.deliveries
    set scheduled_date = p_scheduled_date,
        scheduled_time = p_scheduled_time,
        assigned_driver_id = p_assigned_driver_id,
        notes = nullif(trim(p_notes), '')
    where id = p_delivery_id;

  insert into public.order_activity(order_id, user_id, action, details)
  values (
    v_order_id,
    auth.uid(),
    'delivery_rescheduled',
    jsonb_build_object(
      'delivery_id', p_delivery_id,
      'from_date', v_old_date,
      'to_date', p_scheduled_date,
      'from_time', v_old_time,
      'to_time', p_scheduled_time,
      'from_driver_id', v_old_driver,
      'to_driver_id', p_assigned_driver_id
    )
  );
end;
$$;
revoke all on function public.reschedule_delivery(uuid, date, time, uuid, text) from public;
grant execute on function public.reschedule_delivery(uuid, date, time, uuid, text) to authenticated;

-- Once an order reaches For Delivery, completion belongs exclusively to the
-- linked delivery workflow. This prevents direct order completion from
-- bypassing driver, delivery-status, and audit controls.
create or replace function public.transition_order_status(
  p_order_id uuid,
  p_next_status public.order_status,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.order_status;
  v_action text;
begin
  if p_next_status = 'for_preparation' then
    if not public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]) then
      raise exception 'You do not have permission to start preparation';
    end if;
  elsif not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to transition orders';
  end if;

  select status into v_current from public.orders where id = p_order_id for update;
  if v_current is null then raise exception 'Order not found'; end if;

  if p_next_status = 'cancelled' then
    if v_current in ('completed', 'cancelled') then raise exception 'This order cannot be cancelled'; end if;
    v_action := 'cancelled';
  elsif v_current = 'for_delivery' and p_next_status = 'completed' then
    raise exception 'Complete the linked delivery to complete this order';
  elsif (v_current = 'for_verification' and p_next_status = 'confirmed')
    or (v_current = 'confirmed' and p_next_status = 'for_preparation')
    or (v_current = 'for_preparation' and p_next_status = 'for_delivery') then
    if v_current = 'for_preparation' and exists (
      select 1 from public.order_items where order_id = p_order_id and preparation_status <> 'completed'
    ) then
      raise exception 'All preparation tasks must be completed before delivery';
    end if;
    v_action := 'status_changed';
  else
    raise exception 'Invalid order status transition';
  end if;

  update public.orders set status = p_next_status where id = p_order_id;
  insert into public.order_activity(order_id, user_id, action, details)
  values (p_order_id, auth.uid(), v_action, coalesce(p_details, '{}'::jsonb) || jsonb_build_object('from_status', v_current, 'to_status', p_next_status));
end;
$$;
