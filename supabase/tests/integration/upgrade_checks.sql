-- Run after the rollout migrations on a database that had data (upgrade.sh).
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' upgrade: every historical total is unchanged to the centavo (' || count(*) || ' differ)'
  from upgrade_check.totals s join public.orders o on o.id = s.id where round(public.order_total(o), 2) <> s.total;
select case when count(*) = (select count(*) from upgrade_check.totals) then 'PASS' else 'FAIL' end || ' upgrade: existing orders keep the old adding-up (order_sum)'
  from public.orders o join upgrade_check.totals s on s.id = o.id where o.money_rounding = 'order_sum';
select case when count(*) > 0 then 'PASS' else 'FAIL' end || ' upgrade: line rounding would have changed at least one total, so the check above means something'
  from upgrade_check.totals s where s.total <> (select round(sum(round(oi.quantity * oi.unit_price, 2)), 2) from public.order_items oi where oi.order_id = s.id);
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' upgrade: line counts, quantities and statuses unchanged'
  from upgrade_check.totals s join public.orders o on o.id = s.id
  where s.status <> o.status::text or s.lines <> (select count(*) from public.order_items where order_id = o.id)
     or s.qty <> (select round(coalesce(sum(quantity), 0), 3) from public.order_items where order_id = o.id);
select case when bool_and(c.n = x.n) then 'PASS' else 'FAIL' end || ' upgrade: row counts unchanged in ' || count(*) || ' tables'
  from upgrade_check.counts c cross join lateral (select (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.t), false, true, '')))[1]::text::bigint as n) x;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' upgrade: deliveries, drivers and received-by names unchanged'
  from upgrade_check.deliveries d join public.deliveries n on n.id = d.id
  where (d.order_id, d.assigned_driver_id, d.scheduled_date, d.status, d.completed_at, d.received_by) is distinct from (n.order_id, n.assigned_driver_id, n.scheduled_date, n.status::text, n.completed_at, n.received_by);
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' upgrade: roles and account status unchanged'
  from upgrade_check.roles r join public.profiles p on p.id = r.id where r.role <> p.role::text or r.status <> p.status::text;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' upgrade: price history unchanged'
  from upgrade_check.prices r join public.price_history p on p.id = r.id where (r.selling_price, r.cost_price) is distinct from (p.selling_price, p.cost_price);
-- Legacy orders keep the old order_source value and no order_source_id; the app
-- shows and copies them through the matching order_sources code.
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' upgrade: every legacy order''s source matches an order source the app can show and copy'
  from public.orders o where o.order_source_id is null and not exists (select 1 from public.order_sources s where s.code = o.order_source::text);
select case when count(*) = (select count(*) from public.profiles) then 'PASS' else 'FAIL' end || ' upgrade: go-live scripts gave every account a valid unique username'
  from public.profiles where username ~ '^[a-z][a-z0-9._]{2,29}$';
select case when count(*) = count(distinct lower(username)) then 'PASS' else 'FAIL' end || ' upgrade: usernames unique ignoring case (rico.b@meah.ph and rico.b@gmail.com)' from public.profiles;
select case when count(*) = (select count(*) from public.profiles) then 'PASS' else 'FAIL' end || ' upgrade: every account is reported for an admin to check' from public.username_migration_report;
