-- Regression (Jac, 4 November 2026): changing the time a phone sends with a
-- queued change must never let an already-applied change run again after its
-- duplicate-protection record is pruned. The check is on the server and does
-- not depend on the time the phone sends.
\set ON_ERROR_STOP 1
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if;
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
-- Ages every record of one change by 91 days, as if it ran long ago.
create function pg_temp.age(p_request uuid) returns void language sql as $$
  update public.mutation_requests set created_at = now() - interval '91 days', completed_at = now() - interval '91 days'
    where request_id in (p_request, public.offline_inner_request_id(p_request));
$$;

begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000dd01', 'office-r@meah.test', '{"full_name":"Liza Ramos"}'),
  ('00000000-0000-0000-0000-00000000dd02', 'packer-r@meah.test', '{"full_name":"Carlo Diaz"}'),
  ('00000000-0000-0000-0000-00000000dd03', 'admin-r@meah.test', '{"full_name":"Ana Mercado"}');
update public.profiles set status = 'active', must_change_password = false, role = 'administrative_staff' where id = '00000000-0000-0000-0000-00000000dd01';
update public.profiles set status = 'active', must_change_password = false, role = 'fulfillment_staff' where id = '00000000-0000-0000-0000-00000000dd02';
update public.profiles set status = 'active', must_change_password = false, role = 'administrator' where id = '00000000-0000-0000-0000-00000000dd03';
insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000dd10', 'RP-001', 'Casa Verde');
insert into public.products (id, product_name, unit_of_measurement) values ('00000000-0000-0000-0000-00000000dd11', 'Tomatoes', 'kg');
insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by)
  values ('00000000-0000-0000-0000-00000000dd11', 60, 85, now() - interval '1 day', '00000000-0000-0000-0000-00000000dd03');
create temp table req as select
  jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000dd10', 'requested_delivery_date', current_date + 1, 'order_source_id', (select id from public.order_sources where code = 'phone')) as ord,
  '[{"product_id":"00000000-0000-0000-0000-00000000dd11","quantity":2,"unit_of_measurement":"kg"}]'::jsonb as items;
grant select on req to authenticated;

-- A new order saved from the outbox, its records pruned 91 days later.
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-00000000dd01', $q$select public.offline_create_order(ord, items, 'd0000000-0000-4000-8000-000000000001', jsonb_build_object('queued_at', now())) from req$q$) is null, 'runs: a new order is saved');
select pg_temp.age('d0000000-0000-4000-8000-000000000001');
select pg_temp.ok(public.prune_offline_records() >= 2, 'runs: its records are pruned after 90 days');
select pg_temp.ok((select count(*) = 2 from public.mutation_request_tombstones where request_id in ('d0000000-0000-4000-8000-000000000001', public.offline_inner_request_id('d0000000-0000-4000-8000-000000000001'))),
  'pruning leaves the request ids behind (no arguments or results)');

-- The same request sent again with a forged recent time.
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-00000000dd01', $q$select public.offline_create_order(ord, items, 'd0000000-0000-4000-8000-000000000001', jsonb_build_object('queued_at', now() - interval '1 minute', 'accept_current_prices', true)) from req$q$)
  like 'OFEXP %already applied%', 'a pruned new order sent again with a changed time is refused');
select pg_temp.ok((select count(*) = 1 from public.orders where customer_id = '00000000-0000-0000-0000-00000000dd10'), 'and no second order is created');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-00000000dd01', $q$select public.create_order(ord, items, public.offline_inner_request_id('d0000000-0000-4000-8000-000000000001'), null) from req$q$) is not null
  and (select count(*) = 1 from public.orders where customer_id = '00000000-0000-0000-0000-00000000dd10'), 'the inner request id is refused too');
select pg_temp.ok(not exists (select 1 from public.mutation_requests where request_id = 'd0000000-0000-4000-8000-000000000001'), 'the refusal leaves no new duplicate-protection record');

-- A packing tick that someone later undid: the pruned tick must not tick it again.
create temp table line as select i.id from public.order_items i join public.orders o on o.id = i.order_id where o.customer_id = '00000000-0000-0000-0000-00000000dd10';
grant select on line to authenticated;
update public.orders set status = 'for_preparation' where customer_id = '00000000-0000-0000-0000-00000000dd10';
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-00000000dd02', $q$select public.offline_set_item_packed((select id from line), true, 'd0000000-0000-4000-8000-000000000002', tests.with_pv_item((select id from line), jsonb_build_object('queued_at', now(), 'seen', '{"packed":false,"quantity":2,"unit":"kg"}'::jsonb)))$q$) is null, 'runs: a line is ticked');
select pg_temp.age('d0000000-0000-4000-8000-000000000002');
select pg_temp.ok(public.prune_offline_records() >= 1, 'runs: the tick''s records are pruned');
update public.orders set status = 'for_preparation' where customer_id = '00000000-0000-0000-0000-00000000dd10';
update public.order_items set preparation_status = 'pending' where id = (select id from line);
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-00000000dd02', $q$select public.offline_set_item_packed((select id from line), true, 'd0000000-0000-4000-8000-000000000002', tests.with_pv_item((select id from line), jsonb_build_object('queued_at', now(), 'seen', '{"packed":false,"quantity":2,"unit":"kg"}'::jsonb)))$q$)
  like 'OFEXP %already applied%', 'a pruned tick sent again with a changed time is refused');
select pg_temp.ok((select preparation_status = 'pending' from public.order_items where id = (select id from line)), 'and the line stays unticked');

-- Request ids are per person, and the app cannot read or change the kept ids.
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-00000000dd03', $q$select public.offline_create_order(ord, items, 'd0000000-0000-4000-8000-000000000001', jsonb_build_object('queued_at', now())) from req$q$) is null, 'another person''s request with the same id is not blocked');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-00000000dd01', $q$select count(*) from public.mutation_request_tombstones$q$) like '42501 %'
  and pg_temp.code('00000000-0000-0000-0000-00000000dd01', $q$delete from public.mutation_request_tombstones$q$) like '42501 %', 'the app cannot read or remove the kept request ids');
-- Pruning again is safe.
select pg_temp.ok(public.prune_offline_records() >= 0 and (select count(*) >= 3 from public.mutation_request_tombstones), 'running the cleanup again keeps the ids');
rollback;
