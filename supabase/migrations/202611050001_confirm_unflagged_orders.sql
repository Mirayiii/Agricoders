-- New orders follow MEAH-Prototype 2 (Jac, 4 Nov): an order that isn't
-- flagged for checking is saved as Confirmed and goes straight to Purchasing.
-- A flagged order is saved For verification, as before. Offline orders take
-- the same path, since offline_create_order calls create_order.

create or replace function public.create_order(p_order jsonb, p_items jsonb, p_client_request_id uuid, p_source_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Prototype rule (Jac, 4 Nov): an order that isn't flagged for checking is
  -- confirmed as it is entered; a flagged one waits For verification. The
  -- normal transition is used, so its activity entry and notifications follow.
  if not coalesce((p_order->>'requires_attention')::boolean, false) then
    perform public.transition_order_status(v_order_id, 'confirmed', jsonb_build_object('reason', 'confirmed_on_entry'));
    -- Nothing is left to verify, so the alert the insert raised is withdrawn.
    delete from public.notifications where related_order_id = v_order_id and type = 'order_requires_verification';
  end if;

  select * into v_row from public.orders where id = v_order_id;
  v_result := public.order_money(v_row) || jsonb_build_object('order_number', v_row.order_number, 'status', v_row.status);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$function$;
