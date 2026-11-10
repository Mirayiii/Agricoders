-- Taken before the rollout migrations run (upgrade.sh).
\set ON_ERROR_STOP 1
create schema if not exists upgrade_check;
create table upgrade_check.totals as
  select o.id, o.status::text as status, round(coalesce(sum(oi.quantity * oi.unit_price), 0), 2) as total,
         count(oi.id) as lines, round(coalesce(sum(oi.quantity), 0), 3) as qty
  from public.orders o left join public.order_items oi on oi.order_id = o.id group by o.id, o.status;
create table upgrade_check.counts as
  select 'profiles' t, count(*) n from public.profiles union all
  select 'customers', count(*) from public.customers union all
  select 'products', count(*) from public.products union all
  select 'product_skus', count(*) from public.product_skus union all
  select 'price_history', count(*) from public.price_history union all
  select 'customer_pricing', count(*) from public.customer_pricing union all
  select 'inventory', count(*) from public.inventory union all
  select 'orders', count(*) from public.orders union all
  select 'order_items', count(*) from public.order_items union all
  select 'deliveries', count(*) from public.deliveries union all
  select 'order_activity', count(*) from public.order_activity union all
  select 'notifications', count(*) from public.notifications;
create table upgrade_check.deliveries as select id, order_id, assigned_driver_id, scheduled_date, status::text status, completed_at, received_by from public.deliveries;
create table upgrade_check.roles as select id, role::text role, status::text status from public.profiles;
create table upgrade_check.prices as select id, selling_price, cost_price from public.price_history;
