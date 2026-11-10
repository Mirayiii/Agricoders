-- Customer reporting and customer-order history.  These functions aggregate
-- only rows the caller is already allowed to read; the mobile app never
-- calculates a customer report from a truncated order list.

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
    select o.id, o.customer_id, o.status, o.requested_delivery_date
    from public.orders o
    where public.can_read_order(o.id)
      and (p_start is null or o.requested_delivery_date >= p_start)
      and (p_end is null or o.requested_delivery_date <= p_end)
      and (p_customer_id is null or o.customer_id = p_customer_id)
      and (p_status is null or o.status = p_status)
  ),
  order_totals as (
    select fo.id, fo.customer_id, fo.status, fo.requested_delivery_date,
      coalesce(sum(oi.quantity * oi.unit_price), 0) as order_total
    from filtered_orders fo
    left join public.order_items oi on oi.order_id = fo.id
    group by fo.id, fo.customer_id, fo.status, fo.requested_delivery_date
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
      count(ot.id) as order_count, coalesce(q.quantity_by_unit, '{}'::jsonb) as quantity_by_unit,
      coalesce(s.status_summary, '{}'::jsonb) as status_summary, max(ot.requested_delivery_date) as recent_order_date,
      coalesce(sum(ot.order_total), 0) as total_order_amount
    from public.customers c
    left join order_totals ot on ot.customer_id = c.id
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
revoke all on function public.get_customer_report(date,date,uuid,public.order_status,integer,integer) from public;
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
    coalesce(sum(oi.quantity * oi.unit_price), 0) as total, count(*) over()
  from public.orders o
  left join public.order_items oi on oi.order_id = o.id
  where o.customer_id = p_customer_id
    and public.can_read_order(o.id)
  group by o.id
  order by o.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.get_customer_order_history(uuid,integer,integer) from public;
grant execute on function public.get_customer_order_history(uuid,integer,integer) to authenticated;

create index if not exists order_items_order_unit_idx on public.order_items(order_id, unit_of_measurement);
