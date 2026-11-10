-- Event-backed notifications and server-side operational reports.

alter table public.notifications add column event_key text;
update public.notifications set event_key = 'legacy:' || id::text where event_key is null;
alter table public.notifications alter column event_key set not null;
create unique index notifications_user_event_key_unique on public.notifications(user_id, event_key);

create or replace function public.notify_administrators(p_type text, p_title text, p_message text, p_order_id uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications(user_id, type, title, message, related_order_id, event_key)
  select id, p_type, p_title, p_message, p_order_id, p_type || ':' || coalesce(p_order_id::text, 'general')
  from public.profiles where role in ('administrator', 'administrative_staff') and status = 'active'
  on conflict (user_id, event_key) do nothing;
$$;

create or replace function public.notify_order_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify_administrators('order_requires_verification', 'Order requires verification', new.order_number || ' is ready for verification', new.id);
  end if;
  if tg_op = 'UPDATE' and new.requires_attention and not old.requires_attention then
    perform public.notify_administrators('order_attention', 'Order requires attention', new.order_number || ': ' || coalesce(new.attention_reason, 'Needs review'), new.id);
  end if;
  return new;
end;
$$;

create or replace function public.generate_upcoming_notifications()
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Advance-order reminders go to the personnel who verify and coordinate orders.
  insert into public.notifications(user_id, type, title, message, related_order_id, event_key)
  select p.id, 'upcoming_order', 'Upcoming order', o.order_number || ' is scheduled for ' || o.requested_delivery_date::text, o.id, 'upcoming_order:' || o.id::text || ':' || o.requested_delivery_date::text
  from public.orders o cross join public.profiles p
  where o.requested_delivery_date between current_date and current_date + 1
    and o.status not in ('completed', 'cancelled')
    and p.role in ('administrator', 'administrative_staff') and p.status = 'active'
  on conflict (user_id, event_key) do nothing;

  -- Delivery reminders are limited to active coordinators and the assigned driver.
  insert into public.notifications(user_id, type, title, message, related_order_id, event_key)
  select recipient.id, 'upcoming_delivery', 'Upcoming delivery', o.order_number || ' delivery is scheduled for ' || d.scheduled_date::text, o.id, 'upcoming_delivery:' || d.id::text || ':' || d.scheduled_date::text
  from public.deliveries d join public.orders o on o.id = d.order_id
  join public.profiles recipient on recipient.status = 'active'
  where d.scheduled_date between current_date and current_date + 1
    and d.status in ('scheduled', 'for_delivery')
    and (recipient.role in ('administrator', 'administrative_staff') or recipient.id = d.assigned_driver_id)
  on conflict (user_id, event_key) do nothing;
end;
$$;
revoke all on function public.generate_upcoming_notifications() from public;
grant execute on function public.generate_upcoming_notifications() to authenticated;

create or replace function public.get_order_report(p_start date default null, p_end date default null, p_customer_id uuid default null, p_status public.order_status default null, p_limit integer default 25, p_offset integer default 0)
returns table(order_id uuid, order_number text, customer_name text, status public.order_status, requested_delivery_date date, item_count bigint, total numeric, total_rows bigint)
language sql stable security definer set search_path = public as $$
  select o.id, o.order_number, c.business_name, o.status, o.requested_delivery_date, count(oi.id), coalesce(sum(oi.quantity * oi.unit_price), 0), count(*) over()
  from public.orders o join public.customers c on c.id = o.customer_id left join public.order_items oi on oi.order_id = o.id
  where public.can_read_order(o.id)
    and (p_start is null or o.requested_delivery_date >= p_start)
    and (p_end is null or o.requested_delivery_date <= p_end)
    and (p_customer_id is null or o.customer_id = p_customer_id)
    and (p_status is null or o.status = p_status)
  group by o.id, c.business_name
  order by o.requested_delivery_date desc, o.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.get_order_report(date,date,uuid,public.order_status,integer,integer) from public;
grant execute on function public.get_order_report(date,date,uuid,public.order_status,integer,integer) to authenticated;

create or replace function public.get_product_quantity_report(p_start date default null, p_end date default null, p_customer_id uuid default null, p_status public.order_status default null)
returns table(product_name text, sku text, quantity numeric, unit text)
language sql stable security definer set search_path = public as $$
  select p.product_name, coalesce(ps.selling_sku, ps.buying_sku, 'Base product'), sum(oi.quantity), oi.unit_of_measurement
  from public.orders o join public.order_items oi on oi.order_id = o.id join public.products p on p.id = oi.product_id left join public.product_skus ps on ps.id = oi.product_sku_id
  where public.can_read_order(o.id)
    and (p_start is null or o.requested_delivery_date >= p_start) and (p_end is null or o.requested_delivery_date <= p_end)
    and (p_customer_id is null or o.customer_id = p_customer_id) and (p_status is null or o.status = p_status)
  group by p.product_name, ps.selling_sku, ps.buying_sku, oi.unit_of_measurement
  order by p.product_name, coalesce(ps.selling_sku, ps.buying_sku, 'Base product');
$$;
revoke all on function public.get_product_quantity_report(date,date,uuid,public.order_status) from public;
grant execute on function public.get_product_quantity_report(date,date,uuid,public.order_status) to authenticated;

create or replace function public.get_purchasing_report(p_start date default null, p_end date default null)
returns table(product_name text, sku text, quantity numeric, unit text, delivery_date date)
language sql stable security definer set search_path = public as $$
  select p.product_name, coalesce(ps.selling_sku, ps.buying_sku, 'Base product'), sum(oi.quantity), oi.unit_of_measurement, o.requested_delivery_date
  from public.orders o join public.order_items oi on oi.order_id = o.id join public.products p on p.id = oi.product_id left join public.product_skus ps on ps.id = oi.product_sku_id
  where public.can_read_order(o.id) and o.status in ('confirmed', 'for_preparation')
    and (p_start is null or o.requested_delivery_date >= p_start) and (p_end is null or o.requested_delivery_date <= p_end)
  group by p.product_name, ps.selling_sku, ps.buying_sku, oi.unit_of_measurement, o.requested_delivery_date
  order by o.requested_delivery_date, p.product_name;
$$;
revoke all on function public.get_purchasing_report(date,date) from public;
grant execute on function public.get_purchasing_report(date,date) to authenticated;

create or replace function public.get_delivery_report(p_start date default null, p_end date default null)
returns table(delivery_id uuid, order_id uuid, order_number text, customer_name text, scheduled_date date, scheduled_time time, driver_name text, status public.delivery_status)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then raise exception 'You do not have permission to view delivery reports'; end if;
  return query select d.id, o.id, o.order_number, c.business_name, d.scheduled_date, d.scheduled_time, coalesce(driver.full_name, driver.email), d.status
  from public.deliveries d join public.orders o on o.id = d.order_id join public.customers c on c.id = o.customer_id left join public.profiles driver on driver.id = d.assigned_driver_id
  where (p_start is null or d.scheduled_date >= p_start) and (p_end is null or d.scheduled_date <= p_end)
  order by d.scheduled_date desc, d.scheduled_time desc nulls last;
end;
$$;
revoke all on function public.get_delivery_report(date,date) from public;
grant execute on function public.get_delivery_report(date,date) to authenticated;

create or replace function public.get_margin_report()
returns table(product_name text, sku text, cost numeric, selling numeric, margin numeric, margin_percentage numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then raise exception 'You do not have permission to view margin information'; end if;
  return query
  select p.product_name, coalesce(ps.selling_sku, ps.buying_sku, 'Base product'), ph.cost_price, ph.selling_price, ph.selling_price - ph.cost_price,
    case when ph.cost_price > 0 then round(((ph.selling_price - ph.cost_price) / ph.cost_price) * 100, 2) else null end
  from public.price_history ph join public.products p on p.id = ph.product_id left join public.product_skus ps on ps.id = ph.product_sku_id
  where ph.effective_from <= now() and (ph.effective_to is null or ph.effective_to > now())
  order by p.product_name, ph.effective_from desc;
end;
$$;
revoke all on function public.get_margin_report() from public;
grant execute on function public.get_margin_report() to authenticated;

create index deliveries_status_date_idx on public.deliveries(status, scheduled_date);
create index notifications_event_key_idx on public.notifications(event_key);
