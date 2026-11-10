-- Dashboard metrics and controlled pre-verification order editing.

create or replace function public.get_dashboard_operational_summary()
returns table(
  requiring_attention bigint,
  for_verification bigint,
  confirmed bigint,
  upcoming_orders bigint,
  scheduled_deliveries bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.orders o where o.requires_attention and public.can_read_order(o.id)),
    (select count(*) from public.orders o where o.status = 'for_verification' and public.can_read_order(o.id)),
    (select count(*) from public.orders o where o.status = 'confirmed' and public.can_read_order(o.id)),
    (select count(*) from public.orders o where o.requested_delivery_date >= current_date and o.status not in ('completed', 'cancelled') and public.can_read_order(o.id)),
    (select count(*) from public.deliveries d where d.status = 'scheduled' and (public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) or (public.has_app_role(array['delivery_staff']::public.profile_role[]) and d.assigned_driver_id = auth.uid())));
$$;
revoke all on function public.get_dashboard_operational_summary() from public;
grant execute on function public.get_dashboard_operational_summary() to authenticated;

create or replace function public.get_dashboard_action_required(p_limit integer default 5)
returns table(order_id uuid, order_number text, customer_name text, reason text, requested_delivery_date date, status public.order_status)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.order_number, c.business_name, coalesce(o.attention_reason, 'Requires attention'), o.requested_delivery_date, o.status
  from public.orders o
  join public.customers c on c.id = o.customer_id
  where o.requires_attention and public.can_read_order(o.id)
  order by o.requested_delivery_date asc, o.created_at desc
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.get_dashboard_action_required(integer) from public;
grant execute on function public.get_dashboard_action_required(integer) to authenticated;

create or replace function public.edit_order_with_items(p_order_id uuid, p_order jsonb, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.order_status;
  v_item jsonb;
  v_product_id uuid;
  v_sku_id uuid;
  v_variety_id uuid;
  v_price numeric(12, 2);
  v_cost numeric(12, 2);
  v_before jsonb;
  v_after jsonb;
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

  select status into v_current from public.orders where id = p_order_id for update;
  if v_current is null then raise exception 'Order not found'; end if;
  if v_current <> 'for_verification' then raise exception 'Only orders awaiting verification can be edited'; end if;
  if not exists(select 1 from public.customers where id = (p_order->>'customer_id')::uuid and status = 'active') then raise exception 'Selected customer is unavailable'; end if;

  select jsonb_build_object(
    'customer_id', o.customer_id,
    'requested_delivery_date', o.requested_delivery_date,
    'notes', o.notes,
    'items', coalesce(jsonb_agg(jsonb_build_object('product_id', oi.product_id, 'product_sku_id', oi.product_sku_id, 'variety_id', oi.variety_id, 'quantity', oi.quantity, 'unit_of_measurement', oi.unit_of_measurement, 'unit_price', oi.unit_price, 'notes', oi.notes)) filter (where oi.id is not null), '[]'::jsonb)
  ) into v_before
  from public.orders o left join public.order_items oi on oi.order_id = o.id
  where o.id = p_order_id group by o.id;

  update public.orders set customer_id = (p_order->>'customer_id')::uuid, requested_delivery_date = (p_order->>'requested_delivery_date')::date, notes = nullif(trim(p_order->>'notes'), '') where id = p_order_id;
  delete from public.order_items where order_id = p_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_sku_id := nullif(v_item->>'product_sku_id', '')::uuid;
    v_variety_id := nullif(v_item->>'variety_id', '')::uuid;
    if coalesce((v_item->>'quantity')::numeric, 0) <= 0 or nullif(trim(coalesce(v_item->>'unit_of_measurement', '')), '') is null then raise exception 'Every item needs a positive quantity and unit'; end if;
    if not exists(select 1 from public.products where id = v_product_id and status = 'active') then raise exception 'Selected product is unavailable'; end if;
    if v_sku_id is not null and not exists(select 1 from public.product_skus where id = v_sku_id and product_id = v_product_id and status = 'active') then raise exception 'Selected SKU does not belong to product'; end if;
    if v_variety_id is not null and not exists(select 1 from public.product_varieties where id = v_variety_id and product_id = v_product_id and status = 'active') then raise exception 'Selected variety does not belong to product'; end if;
    select cp.selling_price into v_price from public.customer_pricing cp where cp.customer_id = (p_order->>'customer_id')::uuid and cp.product_id = v_product_id and (cp.product_sku_id is not distinct from v_sku_id) and cp.effective_from <= now() and (cp.effective_to is null or cp.effective_to > now()) order by cp.effective_from desc limit 1;
    if v_price is null then select ph.selling_price, ph.cost_price into v_price, v_cost from public.price_history ph where ph.product_id = v_product_id and (ph.product_sku_id is not distinct from v_sku_id) and ph.effective_from <= now() and (ph.effective_to is null or ph.effective_to > now()) order by ph.effective_from desc limit 1; end if;
    if v_price is null then raise exception 'No active price exists for selected product'; end if;
    if v_cost is null then select ph.cost_price into v_cost from public.price_history ph where ph.product_id = v_product_id and (ph.product_sku_id is not distinct from v_sku_id) and ph.effective_from <= now() and (ph.effective_to is null or ph.effective_to > now()) order by ph.effective_from desc limit 1; end if;
    insert into public.order_items(order_id, product_id, product_sku_id, variety_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price, notes)
    values (p_order_id, v_product_id, v_sku_id, v_variety_id, (v_item->>'quantity')::numeric, trim(v_item->>'unit_of_measurement'), v_price, v_price, coalesce(v_cost, 0), nullif(trim(v_item->>'notes'), ''));
  end loop;

  select jsonb_build_object('customer_id', o.customer_id, 'requested_delivery_date', o.requested_delivery_date, 'notes', o.notes, 'item_count', count(oi.id)) into v_after from public.orders o left join public.order_items oi on oi.order_id = o.id where o.id = p_order_id group by o.id;
  insert into public.order_activity(order_id, user_id, action, details) values (p_order_id, auth.uid(), 'order_edited', jsonb_build_object('before', v_before, 'after', v_after));
end;
$$;
revoke all on function public.edit_order_with_items(uuid, jsonb, jsonb) from public;
grant execute on function public.edit_order_with_items(uuid, jsonb, jsonb) to authenticated;
