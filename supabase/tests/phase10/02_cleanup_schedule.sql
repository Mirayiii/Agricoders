-- Phase 10 (D-OF3): the 90-day cleanup is prepared but not switched on; it
-- keeps pending requests, and a pruned request can't be applied again.
\set ON_ERROR_STOP 1
create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label; else raise exception 'FAIL %', label; end if;
end $$;
create function pg_temp.code(uid uuid, sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
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
create function pg_temp.owner_err(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000cc01', 'office-c@meah.test', '{"full_name":"Liza Ramos"}'),
  ('00000000-0000-0000-0000-00000000cc02', 'driver-c@meah.test', '{"full_name":"Rico Bautista"}');
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-00000000cc01';
update public.profiles set status = 'active', role = 'delivery_staff' where id = '00000000-0000-0000-0000-00000000cc02';
insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000cc10', 'CL-001', 'Casa Verde');
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date) values
  ('00000000-0000-0000-0000-00000000cc20', '00000000-0000-0000-0000-00000000cc10', 'phone', '00000000-0000-0000-0000-00000000cc01', 'for_verification', current_date + 1),
  ('00000000-0000-0000-0000-00000000cc21', '00000000-0000-0000-0000-00000000cc10', 'phone', '00000000-0000-0000-0000-00000000cc01', 'for_delivery', current_date);
insert into public.deliveries (id, order_id, assigned_driver_id, scheduled_date) values
  ('00000000-0000-0000-0000-00000000cc30', '00000000-0000-0000-0000-00000000cc21', '00000000-0000-0000-0000-00000000cc02', current_date);

-- Not switched on: no job exists and the app can't switch it on.
select pg_temp.ok(not exists (select 1 from pg_namespace where nspname = 'cron')
  or not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'cron' and c.relname = 'job')
  or (select count(*) = 0 from pg_temp.owner_err('select 1') x), 'the migration schedules nothing');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.enable_offline_cleanup_schedule()', 'execute')
  and not has_function_privilege('anon', 'public.enable_offline_cleanup_schedule()', 'execute')
  and not has_function_privilege('service_role', 'public.enable_offline_cleanup_schedule()', 'execute')
  and not has_function_privilege('authenticated', 'public.disable_offline_cleanup_schedule()', 'execute'), 'only the database owner can switch the schedule on or off');
select pg_temp.ok(
  case when exists (select 1 from pg_extension where extname = 'pg_cron') then true
  else pg_temp.owner_err('select public.enable_offline_cleanup_schedule()') like 'pg_cron is not enabled%' end,
  'without pg_cron, switching it on explains what is missing');
select pg_temp.ok(
  case when exists (select 1 from pg_extension where extname = 'pg_cron') then true
  else public.disable_offline_cleanup_schedule() = 'pg_cron is not enabled; nothing is scheduled' end,
  'switching it off without pg_cron is safe');

-- What the cleanup keeps and removes.
delete from public.mutation_requests;
insert into public.mutation_requests (user_id, request_id, rpc_name, args_hash, status, created_at, completed_at) values
  ('00000000-0000-0000-0000-00000000cc01', 'c0000000-0000-4000-8000-000000000001', 'offline_confirm_order', 'x', 'done', now() - interval '120 days', now() - interval '120 days'),
  ('00000000-0000-0000-0000-00000000cc01', 'c0000000-0000-4000-8000-000000000002', 'admin_reset_password', 'x', 'pending', now() - interval '120 days', null),
  ('00000000-0000-0000-0000-00000000cc01', 'c0000000-0000-4000-8000-000000000003', 'create_order', 'x', 'done', now() - interval '60 days', now() - interval '60 days'),
  ('00000000-0000-0000-0000-00000000cc01', 'c0000000-0000-4000-8000-000000000004', 'create_order', 'x', 'done', now() - interval '95 days', now() - interval '85 days');
select pg_temp.ok(public.prune_offline_records() = 1, 'runs: one record older than 90 days is removed');
select pg_temp.ok(not exists (select 1 from public.mutation_requests where request_id = 'c0000000-0000-4000-8000-000000000001'), 'a finished record older than 90 days is removed');
select pg_temp.ok(exists (select 1 from public.mutation_requests where request_id = 'c0000000-0000-4000-8000-000000000002'), 'a pending request is kept however old');
select pg_temp.ok(exists (select 1 from public.mutation_requests where request_id = 'c0000000-0000-4000-8000-000000000003'), 'a record younger than 90 days is kept');
select pg_temp.ok(exists (select 1 from public.mutation_requests where request_id = 'c0000000-0000-4000-8000-000000000004'), 'age counts from when the request finished');

-- A pruned request can't be applied again: anything that old is past the 30-day limit.
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-00000000cc01', $q$select public.offline_confirm_order('00000000-0000-0000-0000-00000000cc20', 'c0000000-0000-4000-8000-000000000001', jsonb_build_object('queued_at', now() - interval '120 days'))$q$) like 'OFEXP %', 'replaying a pruned confirm is refused as expired');
select pg_temp.ok((select status = 'for_verification' from public.orders where id = '00000000-0000-0000-0000-00000000cc20')
  and not exists (select 1 from public.mutation_requests where request_id = 'c0000000-0000-4000-8000-000000000001'), 'and changes nothing, leaving no new record');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-00000000cc02', $q$select public.offline_complete_delivery('00000000-0000-0000-0000-00000000cc30', null, 'c0000000-0000-4000-8000-000000000009', jsonb_build_object('queued_at', now() - interval '91 days'))$q$) like 'OFEXP %', 'a 91-day-old delivery is refused as expired');
select pg_temp.ok((select status = 'scheduled' from public.deliveries where id = '00000000-0000-0000-0000-00000000cc30'), 'the stop is unchanged');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-00000000cc01', $q$select public.offline_confirm_order('00000000-0000-0000-0000-00000000cc20', gen_random_uuid(), jsonb_build_object('queued_at', now() + interval '3 days'))$q$) like 'OFEXP %future%', 'a saved time far in the future is refused');
select pg_temp.ok(pg_temp.code('00000000-0000-0000-0000-00000000cc01', $q$select public.offline_confirm_order('00000000-0000-0000-0000-00000000cc20', gen_random_uuid(), jsonb_build_object('queued_at', now() + interval '2 hours'))$q$) is null, 'a phone clock a little ahead is allowed');
rollback;
