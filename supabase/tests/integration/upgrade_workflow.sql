-- Legacy orders, drivers and deliveries go through the new workflow after the
-- upgrade (upgrade.sh), with real role accounts (JWT subject set per call).
\set ON_ERROR_STOP 1
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label; else raise notice 'FAIL %', label; end if;
end $$;
create function pg_temp.code(uid uuid, sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  set local role authenticated;
  begin
    execute sql;
  exception when others then
    reset role;
    return sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  return null;
end $$;
create function pg_temp.off(seen jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('queued_at', now() - interval '2 hours', 'seen', seen);
$$;
\set admin '''11111111-0000-0000-0000-000000000001'''
\set office '''11111111-0000-0000-0000-000000000002'''
\set packer '''11111111-0000-0000-0000-000000000003'''
\set driver '''11111111-0000-0000-0000-000000000004'''
\set gone '''11111111-0000-0000-0000-000000000005'''
begin;
-- Go-live step 4 (D11) asks every existing account for a new password first.
select pg_temp.ok(pg_temp.code(:packer, $q$select public.start_packing('55555555-0000-0000-0000-000000000003', gen_random_uuid())$q$) like '42501 %', 'legacy: after go-live, nobody can change data before choosing a new password');
-- Each person then sets a new password (Auth plus the change-password function).
update public.profiles set must_change_password = false where status = 'active';
create temp table seen as select id, updated_at from public.orders;
grant select on seen to authenticated;

-- Packing a legacy order that was half packed before the upgrade.
select pg_temp.ok(pg_temp.code(:packer, format($q$select public.offline_set_item_packed(%L, true, gen_random_uuid(), %L)$q$,
  (select id from public.order_items where order_id = '55555555-0000-0000-0000-000000000006' and preparation_status = 'pending'),
  pg_temp.off('{"packed":false,"quantity":1,"unit":"head"}'))) is null, 'legacy: packing staff tick the last line of a half-packed legacy order');
select pg_temp.ok((select status = 'for_delivery' from public.orders where id = '55555555-0000-0000-0000-000000000006'), 'legacy: the order moves to For delivery when every line is packed');
select pg_temp.ok(pg_temp.code(:office, $q$select public.create_delivery('55555555-0000-0000-0000-000000000006', current_date + 1, null, '11111111-0000-0000-0000-000000000004', null)$q$) is null, 'legacy: office staff schedule it for a legacy driver');
select pg_temp.ok(pg_temp.code(:driver, format($q$select public.offline_complete_delivery(%L, 'Maria Santos', gen_random_uuid(), %L)$q$,
  (select id from public.deliveries where order_id = '55555555-0000-0000-0000-000000000006'),
  pg_temp.off(jsonb_build_object('scheduled_date', current_date + 1, 'order_updated_at', (select updated_at from public.orders where id = '55555555-0000-0000-0000-000000000006'))))) is null,
  'legacy: the driver marks it delivered (queued offline, then sent)');
select pg_temp.ok((select o.status = 'completed' and d.status = 'completed' and d.received_by = 'Maria Santos' from public.orders o join public.deliveries d on d.order_id = o.id where o.id = '55555555-0000-0000-0000-000000000006'), 'legacy: order and delivery completed, received-by saved');
select pg_temp.ok((select round((r.content->>'total')::numeric, 2) = s.total from public.delivery_receipts r join upgrade_check.totals s on s.id = r.order_id where r.order_id = '55555555-0000-0000-0000-000000000006'), 'legacy: its receipt total equals the total before the upgrade');

-- A delivery scheduled before the upgrade.
select pg_temp.ok(pg_temp.code(:driver, format($q$select public.offline_complete_delivery('66666666-0000-0000-0000-000000000002', 'Store guard', gen_random_uuid(), %L)$q$,
  pg_temp.off(jsonb_build_object('scheduled_date', current_date)))) is null, 'legacy: a delivery scheduled before the upgrade can be marked delivered');
select pg_temp.ok((select round((r.content->>'total')::numeric, 2) = s.total from public.delivery_receipts r join upgrade_check.totals s on s.id = r.order_id where r.order_id = '55555555-0000-0000-0000-000000000002'), 'legacy: that receipt keeps the old total (0.5 crate and 3 heads)');

-- An order completed before the upgrade gets a receipt with its old total, once.
select pg_temp.ok(pg_temp.code(:office, $q$select public.issue_delivery_receipt('55555555-0000-0000-0000-000000000001', gen_random_uuid())$q$) is null
  and pg_temp.code(:office, $q$select public.issue_delivery_receipt('55555555-0000-0000-0000-000000000001', gen_random_uuid())$q$) is null, 'legacy: a completed legacy order gets a receipt, and asking again works');
select pg_temp.ok((select count(*) = 1 from public.delivery_receipts where order_id = '55555555-0000-0000-0000-000000000001'), 'legacy: still one receipt for it');
select pg_temp.ok((select round((r.content->>'total')::numeric, 2) = s.total from public.delivery_receipts r join upgrade_check.totals s on s.id = r.order_id where r.order_id = '55555555-0000-0000-0000-000000000001'), 'legacy: completed order receipt total unchanged (309.30)');

-- Confirming and packing legacy orders.
select pg_temp.ok(pg_temp.code(:packer, $q$select public.start_packing('55555555-0000-0000-0000-000000000003', gen_random_uuid())$q$) is null, 'legacy: a confirmed legacy order can be packed');
select pg_temp.ok(pg_temp.code(:office, format($q$select public.offline_confirm_order('55555555-0000-0000-0000-000000000004', gen_random_uuid(), %L)$q$,
  pg_temp.off(jsonb_build_object('updated_at', (select updated_at from seen where id = '55555555-0000-0000-0000-000000000004'))))) like 'OFCON %flagged%', 'legacy: a flagged legacy order is not confirmed from the offline queue');
select pg_temp.ok((select status = 'for_verification' from public.orders where id = '55555555-0000-0000-0000-000000000004'), 'legacy: it stays For verification');

-- New order for a legacy customer at today's prices, then the reports.
select pg_temp.ok(pg_temp.code(:office, format($q$select public.offline_create_order(%L, '[{"product_id":"33333333-0000-0000-0000-000000000003","quantity":1.257,"unit_of_measurement":"kg"}]', gen_random_uuid(), %L)$q$,
  jsonb_build_object('customer_id', '22222222-0000-0000-0000-000000000002', 'order_source_id', (select id from public.order_sources order by sort_order limit 1), 'requested_delivery_date', current_date + 2),
  jsonb_build_object('queued_at', now(), 'seen_prices', '[{"product_id":"33333333-0000-0000-0000-000000000003","unit":"kg","price":65.35}]'::jsonb))) is null, 'legacy: a new order for a legacy customer saves at the legacy price');
select pg_temp.ok((select o.money_rounding = 'line' and public.order_total(o) = 82.14 from public.orders o where o.created_at > now() - interval '1 minute' and o.customer_id = '22222222-0000-0000-0000-000000000002'), 'legacy: the new order rounds per line (1.257 x 65.35 = 82.14)');
select pg_temp.ok(pg_temp.code(:admin, $q$select public.get_order_report(null, null, null, null, 100, 0)$q$) is null
  and (select bool_and(round(r.total, 2) = s.total) from upgrade_check.totals s join public.get_order_report(null, null, null, null, 100, 0) r on r.order_id = s.id), 'legacy: the order report shows the old totals');
select pg_temp.ok(pg_temp.code(:gone, $q$select public.start_packing('55555555-0000-0000-0000-000000000003', gen_random_uuid())$q$) like '42501 %', 'legacy: an account that was inactive before the upgrade stays locked out');
rollback;
