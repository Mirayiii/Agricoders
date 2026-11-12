-- DR number = order number (Jac, 5 Nov 2026): one server sequence, receipt
-- from Confirmed with no Issue step, numbers never change or get reused.
\set ON_ERROR_STOP 1
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if;
end $$;
create function pg_temp.err(uid uuid, sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  set local role authenticated;
  begin
    execute sql;
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return null;
end $$;
create function pg_temp.run(uid uuid, sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  set local role authenticated;
  execute sql into v;
  reset role;
  return v;
end $$;

begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000013c1', 'office13@meah.test', '{"full_name":"Liza Office"}');
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000013c1';
insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000c131', 'N13-001', 'Casa Verde');
insert into public.products (id, product_name, unit_of_measurement) values ('00000000-0000-0000-0000-00000000b131', 'N13 Onions', 'kg');
insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by)
  values ('00000000-0000-0000-0000-00000000b131', 60, 85, now() - interval '1 day', '00000000-0000-0000-0000-0000000013c1');
-- An older order numbered ORD-#### with no receipt yet.
insert into public.orders (id, customer_id, order_number, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-0000000013e0', '00000000-0000-0000-0000-00000000c131', 'ORD-0004', 'phone', '00000000-0000-0000-0000-0000000013c1', 'confirmed', current_date + 1);

create temp table t (name text primary key, value jsonb) on commit drop;
grant all on t to authenticated;
create function pg_temp.new_order(req uuid) returns jsonb language sql as $$
  select pg_temp.run('00000000-0000-0000-0000-0000000013c1', format($q$select public.create_order(%L, %L, %L)$q$,
    jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c131', 'requested_delivery_date', current_date + 1, 'order_source_id', (select id from public.order_sources where is_active order by sort_order nulls last limit 1)),
    '[{"product_id":"00000000-0000-0000-0000-00000000b131","quantity":2,"unit_of_measurement":"kg"}]'::jsonb, req));
$$;
create function pg_temp.num(name text) returns text language sql as $$
  select order_number from public.orders where id = ((select value from t where t.name = num.name)->>'order_id')::uuid;
$$;
create function pg_temp.digits(v text) returns int language sql as $$ select substring(v from '[0-9]+$')::int $$;

insert into t values ('a', pg_temp.new_order('13131313-1313-4313-8313-131313131301'));
insert into t values ('a_again', pg_temp.new_order('13131313-1313-4313-8313-131313131301'));
insert into t values ('b', pg_temp.new_order('13131313-1313-4313-8313-131313131302'));

select pg_temp.ok(pg_temp.num('a') ~ '^DR-[0-9]{4,}$' and pg_temp.num('b') ~ '^DR-[0-9]{4,}$' and pg_temp.num('a') <> pg_temp.num('b'), 'new orders are numbered DR-#### by the server, each once');
select pg_temp.ok((select value->>'order_id' from t where name = 'a_again') = (select value->>'order_id' from t where name = 'a'), 'a retried save returns the first order');
select pg_temp.ok((select count(*) = 2 from public.orders where customer_id = '00000000-0000-0000-0000-00000000c131' and order_number like 'DR-%'), 'and takes no second number');
select pg_temp.ok(pg_temp.digits(pg_temp.num('b')) > pg_temp.digits(pg_temp.num('a')), 'numbers go up');
select pg_temp.ok((select bool_and(public.dr_label(r.dr_number) = o.order_number) and count(*) = 2
  from public.orders o join public.delivery_receipts r on r.order_id = o.id where o.order_number like 'DR-%' and o.customer_id = '00000000-0000-0000-0000-00000000c131'),
  'each confirmed order has its receipt at once, with the order number as its DR number (no Issue step)');

-- Cancelling keeps the number; the receipt is marked VOID; the number is never reused.
select pg_temp.ok(pg_temp.err('00000000-0000-0000-0000-0000000013c1', format($q$select public.transition_order_status(%L, 'cancelled', '{"reason":"Duplicate"}'::jsonb)$q$, (select value->>'order_id' from t where name = 'b'))) is null, 'the office cancels the second order');
select pg_temp.ok((select voided_at is not null and public.dr_label(dr_number) = pg_temp.num('b') from public.delivery_receipts where order_id = ((select value from t where name = 'b')->>'order_id')::uuid), 'its receipt is marked VOID and keeps the number');
insert into t values ('c', pg_temp.new_order('13131313-1313-4313-8313-131313131303'));
select pg_temp.ok(pg_temp.digits(pg_temp.num('c')) > pg_temp.digits(pg_temp.num('b')), 'a cancelled number is never reused');

-- The older ORD order gets the next free number when its receipt is first opened.
insert into t values ('old', pg_temp.run('00000000-0000-0000-0000-0000000013c1', $q$select public.get_delivery_receipt('00000000-0000-0000-0000-0000000013e0')$q$));
select pg_temp.ok((select (value->>'dr_number')::int > pg_temp.digits(pg_temp.num('c')) from t where name = 'old'), 'an ORD order''s receipt takes the next DR number, so it clashes with no DR order');
select pg_temp.ok((select order_number = 'ORD-0004' from public.orders where id = '00000000-0000-0000-0000-0000000013e0'), 'and the order keeps its ORD number');
select pg_temp.ok((select count(*) = count(distinct dr_number) from public.delivery_receipts), 'no two receipts share a DR number');
insert into t values ('d', pg_temp.new_order('13131313-1313-4313-8313-131313131304'));
select pg_temp.ok(pg_temp.digits(pg_temp.num('d')) > (select (value->>'dr_number')::int from t where name = 'old'), 'the next order takes a number after that receipt');
select pg_temp.ok(public.dr_label(7) = 'DR-0007' and public.dr_label(12345) = 'DR-12345', 'labels keep every digit past 9999');
rollback;
