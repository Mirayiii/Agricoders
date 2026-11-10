-- MEAH controlled fulfillment workflow. Apply after security hardening.
-- Preparation remains item-based so existing orders stay intact; the added
-- fields capture preparation-specific context without duplicating order data.

alter table public.order_items
  add column preparation_notes text,
  add column preparation_started_by uuid references public.profiles(id) on delete restrict,
  add column preparation_started_at timestamptz;

-- Allow the existing app queries to read the new non-financial preparation
-- fields while preserving the Part 1 restrictions on cost and special prices.
grant select (preparation_notes, preparation_started_by, preparation_started_at)
  on public.order_items to authenticated;

-- Fulfillment personnel can see delivery context only for orders that are in
-- their preparation/delivery workflow. Delivery scheduling remains unchanged.
create policy "fulfillment_read_workflow_deliveries"
  on public.deliveries for select to authenticated
  using (
    public.has_app_role(array['fulfillment_staff']::public.profile_role[])
    and exists (
      select 1 from public.orders o
      where o.id = deliveries.order_id
        and o.status in ('for_preparation', 'for_delivery')
    )
  );

-- All order transitions remain server-controlled. Fulfillment staff may start
-- preparation, but confirmation, cancellation, and completion remain limited
-- to administrative roles. A preparation order cannot be moved to delivery
-- until every item is completed.
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

  select status into v_current
  from public.orders
  where id = p_order_id
  for update;

  if v_current is null then
    raise exception 'Order not found';
  end if;

  if p_next_status = 'cancelled' then
    if v_current in ('completed', 'cancelled') then
      raise exception 'This order cannot be cancelled';
    end if;
    v_action := 'cancelled';
  elsif (v_current = 'for_verification' and p_next_status = 'confirmed')
    or (v_current = 'confirmed' and p_next_status = 'for_preparation')
    or (v_current = 'for_preparation' and p_next_status = 'for_delivery')
    or (v_current = 'for_delivery' and p_next_status = 'completed') then
    if v_current = 'for_preparation'
      and p_next_status = 'for_delivery'
      and exists (
        select 1 from public.order_items
        where order_id = p_order_id
          and preparation_status <> 'completed'
      ) then
      raise exception 'All preparation tasks must be completed before delivery';
    end if;
    v_action := 'status_changed';
  else
    raise exception 'Invalid order status transition';
  end if;

  update public.orders set status = p_next_status where id = p_order_id;
  insert into public.order_activity(order_id, user_id, action, details)
  values (
    p_order_id,
    auth.uid(),
    v_action,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('from_status', v_current, 'to_status', p_next_status)
  );
end;
$$;

-- Preparation updates are valid only while the parent order is in preparation.
-- Each step is forward-only, creates an append-only audit record, and the
-- final completed item advances the order exactly one required state.
drop function if exists public.update_preparation_status(uuid, public.preparation_status);
create or replace function public.update_preparation_status(
  p_item_id uuid,
  p_status public.preparation_status,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_status public.order_status;
  v_previous public.preparation_status;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have preparation access';
  end if;

  select oi.order_id, oi.preparation_status, o.status
    into v_order_id, v_previous, v_order_status
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = p_item_id
  for update of oi, o;

  if v_order_id is null then
    raise exception 'Preparation item not found';
  end if;
  if v_order_status <> 'for_preparation' then
    raise exception 'Preparation can start only after the order moves to For Preparation';
  end if;

  if p_status = v_previous then
    if p_notes is null then
      raise exception 'Preparation status is unchanged';
    end if;
    update public.order_items
      set preparation_notes = nullif(trim(p_notes), '')
      where id = p_item_id;
    insert into public.order_activity(order_id, user_id, action, details)
    values (v_order_id, auth.uid(), 'preparation_notes_updated', jsonb_build_object('item_id', p_item_id));
    return;
  end if;

  if not (
    (v_previous = 'pending' and p_status = 'in_progress')
    or (v_previous = 'in_progress' and p_status = 'completed')
  ) then
    raise exception 'Invalid preparation status transition';
  end if;

  update public.order_items
    set preparation_status = p_status,
        preparation_notes = case when p_notes is null then preparation_notes else nullif(trim(p_notes), '') end,
        preparation_started_by = case when p_status = 'in_progress' then auth.uid() else preparation_started_by end,
        preparation_started_at = case when p_status = 'in_progress' then now() else preparation_started_at end,
        prepared_by = case when p_status = 'completed' then auth.uid() else prepared_by end,
        prepared_at = case when p_status = 'completed' then now() else prepared_at end
    where id = p_item_id;

  insert into public.order_activity(order_id, user_id, action, details)
  values (
    v_order_id,
    auth.uid(),
    'preparation_status_changed',
    jsonb_build_object('item_id', p_item_id, 'from_status', v_previous, 'to_status', p_status)
  );

  if p_status = 'completed'
    and not exists (
      select 1 from public.order_items
      where order_id = v_order_id
        and preparation_status <> 'completed'
    ) then
    update public.orders
      set status = 'for_delivery'
      where id = v_order_id
        and status = 'for_preparation';

    if found then
      insert into public.order_activity(order_id, user_id, action, details)
      values (
        v_order_id,
        auth.uid(),
        'status_changed',
        jsonb_build_object('from_status', 'for_preparation', 'to_status', 'for_delivery', 'reason', 'all_preparation_tasks_completed')
      );
    end if;
  end if;
end;
$$;
revoke all on function public.update_preparation_status(uuid, public.preparation_status, text) from public;
grant execute on function public.update_preparation_status(uuid, public.preparation_status, text) to authenticated;

-- Delivery status updates are deliberately separate from order transitions.
-- They cannot skip preparation, and completion is the only path that moves an
-- order from For Delivery to Completed.
create or replace function public.update_delivery_status(
  p_delivery_id uuid,
  p_status public.delivery_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_current public.delivery_status;
  v_order_status public.order_status;
  v_is_management boolean;
begin
  v_is_management := public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]);

  select d.order_id, d.status, o.status
    into v_order_id, v_current, v_order_status
  from public.deliveries d
  join public.orders o on o.id = d.order_id
  where d.id = p_delivery_id
  for update of d, o;

  if v_order_id is null then
    raise exception 'Delivery not found';
  end if;
  if not v_is_management and not (
    public.has_app_role(array['delivery_staff']::public.profile_role[])
    and exists (
      select 1 from public.deliveries d
      where d.id = p_delivery_id and d.assigned_driver_id = auth.uid()
    )
  ) then
    raise exception 'You do not have delivery access';
  end if;

  if p_status = 'cancelled' then
    if not v_is_management or v_current = 'completed' then
      raise exception 'This delivery cannot be cancelled';
    end if;
  elsif v_current = 'scheduled' and p_status = 'for_delivery' then
    if v_order_status <> 'for_delivery' then
      raise exception 'The order must complete preparation before delivery starts';
    end if;
  elsif v_current = 'for_delivery' and p_status = 'completed' then
    if v_order_status <> 'for_delivery' then
      raise exception 'Only orders For Delivery can be completed';
    end if;
  else
    raise exception 'Invalid delivery status transition';
  end if;

  update public.deliveries
    set status = p_status,
        completed_at = case when p_status = 'completed' then now() else completed_at end,
        cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end
    where id = p_delivery_id;

  insert into public.order_activity(order_id, user_id, action, details)
  values (
    v_order_id,
    auth.uid(),
    'delivery_status_changed',
    jsonb_build_object('from_status', v_current, 'to_status', p_status, 'delivery_id', p_delivery_id)
  );

  if p_status = 'completed' then
    update public.orders
      set status = 'completed'
      where id = v_order_id
        and status = 'for_delivery';
    insert into public.order_activity(order_id, user_id, action, details)
    values (
      v_order_id,
      auth.uid(),
      'status_changed',
      jsonb_build_object('from_status', 'for_delivery', 'to_status', 'completed', 'delivery_id', p_delivery_id)
    );
  end if;
end;
$$;
revoke all on function public.update_delivery_status(uuid, public.delivery_status) from public;
grant execute on function public.update_delivery_status(uuid, public.delivery_status) to authenticated;
