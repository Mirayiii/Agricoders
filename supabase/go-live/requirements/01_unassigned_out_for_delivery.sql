-- Go-live check for DE-04 (read-only; changes nothing).
-- After the requirements migrations, a stop cannot be marked delivered until
-- a driver is assigned. Run this on the live database just before and just
-- after applying them. Every row is a stop the team must assign to the
-- driver who actually has it, before anyone tries to complete it.
select
  o.order_number,
  c.business_name as customer,
  d.scheduled_date,
  d.scheduled_time,
  d.status as delivery_status,
  o.status as order_status,
  d.id as delivery_id
from public.deliveries d
join public.orders o on o.id = d.order_id
join public.customers c on c.id = o.customer_id
where d.assigned_driver_id is null
  and d.status not in ('completed', 'cancelled')
  and o.status not in ('completed', 'cancelled')
order by (o.status = 'for_delivery') desc, d.scheduled_date, d.scheduled_time nulls last, o.order_number;
