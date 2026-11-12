-- Integration review: which accounts the server lets call each function the
-- app can reach, checked with real role accounts (JWT subject per call), not
-- the UI role preview. Each function is called with empty arguments; a call
-- the role may make fails on the arguments instead of on permission.
-- Run by run_local.sh on the database it builds.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'perm.admin@meah.test', '{"full_name":"A"}'),
  ('a0000000-0000-0000-0000-000000000002', 'perm.office@meah.test', '{"full_name":"O"}'),
  ('a0000000-0000-0000-0000-000000000003', 'perm.packer@meah.test', '{"full_name":"P"}'),
  ('a0000000-0000-0000-0000-000000000004', 'perm.driver@meah.test', '{"full_name":"D"}'),
  ('a0000000-0000-0000-0000-000000000005', 'perm.inactive@meah.test', '{"full_name":"I"}'),
  ('a0000000-0000-0000-0000-000000000006', 'perm.newpass@meah.test', '{"full_name":"M"}');
update public.profiles p set role = v.role::public.profile_role, status = v.status::public.account_status,
    must_change_password = v.mcp, must_change_reason = case when v.mcp then 'policy_upgrade' end
  from (values ('a0000000-0000-0000-0000-000000000001'::uuid, 'administrator', 'active', false),
               ('a0000000-0000-0000-0000-000000000002', 'administrative_staff', 'active', false),
               ('a0000000-0000-0000-0000-000000000003', 'fulfillment_staff', 'active', false),
               ('a0000000-0000-0000-0000-000000000004', 'delivery_staff', 'active', false),
               ('a0000000-0000-0000-0000-000000000005', 'administrator', 'inactive', false),
               ('a0000000-0000-0000-0000-000000000006', 'administrator', 'active', true)) v(id, role, status, mcp)
  where p.id = v.id;

create temp table who (code text, uid uuid, db_role text);
insert into who values ('admin', 'a0000000-0000-0000-0000-000000000001', 'authenticated'), ('office', 'a0000000-0000-0000-0000-000000000002', 'authenticated'),
  ('packer', 'a0000000-0000-0000-0000-000000000003', 'authenticated'), ('driver', 'a0000000-0000-0000-0000-000000000004', 'authenticated'),
  ('inactive', 'a0000000-0000-0000-0000-000000000005', 'authenticated'), ('new_password', 'a0000000-0000-0000-0000-000000000006', 'authenticated'),
  ('signed_out', null, 'anon');

-- Who may change data through each function (everyone else must be refused).
create temp table expected (fn text primary key, allowed text[]);
insert into expected values
  ('add_delivery_time_slot', '{admin}'), ('remove_delivery_time_slot', '{admin}'),
  ('add_order_source', '{admin}'), ('remove_order_source', '{admin}'),
  ('admin_change_username', '{admin}'), ('admin_unlock_user', '{admin}'),
  ('apply_order_discount', '{admin,office}'), ('remove_order_discount', '{admin,office}'),
  ('set_sales_invoice_number', '{admin,office}'), ('assign_delivery_driver', '{admin,office}'),
  -- Delivery staff may also issue the receipt, but only for their own stop (phase6 tests); with no stop they are refused.
  ('reorder_route', '{admin,office}'), ('issue_delivery_receipt', '{admin,office}'),
  ('create_order', '{admin,office}'), ('offline_create_order', '{admin,office}'), ('offline_confirm_order', '{admin,office}'),
  -- Prototype (5 Nov): products and stock for admin, office and purchasing; prices and customer archive for admin and office.
  ('create_product', '{admin,office,packer}'), ('update_product', '{admin,office,packer}'), ('set_product_archived', '{admin,office,packer}'),
  ('set_product_price', '{admin,office}'), ('batch_update_prices', '{admin,office}'), ('adjust_inventory', '{admin,office,packer}'),
  ('save_customer', '{admin,office}'), ('set_customer_archived', '{admin,office}'),
  ('get_customers', '{admin,office}'), ('get_customer_profile', '{admin,office}'), ('get_price_history', '{admin,office}'), ('get_batch_price_sheet', '{admin,office}'),
  ('start_packing', '{admin,office,packer}'), ('cancel_packing', '{admin,office,packer}'), ('set_item_packed', '{admin,office,packer}'),
  ('offline_set_item_packed', '{admin,office,packer}'),
  -- Requirement PU-01 and SI-02: To Buy is for purchasing staff and the administrator.
  ('get_buy_list', '{admin,packer}'), ('set_buy_list_bought', '{admin,packer}'), ('get_purchasing_today', '{admin,packer}'),
  ('get_usual_quantities', '{admin,office}'),
  -- Prototype (5 Nov): the administrator, the office and delivery staff (their own stops).
  ('complete_delivery', '{admin,office,driver}'), ('offline_complete_delivery', '{admin,office,driver}'),
  -- Products & stock list: admin, office and purchasing (prototype, 5 Nov).
  -- (get_inventory_list and get_inventory_activity return nothing to others; phase8 tests.)
  ('get_products_overview', '{admin,office,packer}'),
  ('set_my_notification_preferences', '{admin,office,packer,driver}'),
  ('generate_upcoming_notifications', '{admin,office,packer,driver}'),
  ('get_sales_report', '{admin}'), ('get_order_report', '{admin}'), ('get_customer_report', '{admin}'), ('get_delivery_report', '{admin}'),
  ('get_margin_report', '{admin}'), ('get_order_margin_summary', '{admin}'), ('get_purchasing_report', '{admin}'),
  ('get_product_quantity_report', '{admin}'), ('get_daily_prices', '{admin}'), ('get_item_analytics', '{admin}'), ('get_customer_statement', '{admin}');

create temp table result (fn text, who text, refused boolean, detail text);
grant all on result to authenticated, anon;
do $$
declare
  f record; w record; q text; v_state text; v_msg text;
begin
  for f in
    select e.fn, p.proname, (select string_agg(case when a.n = 'p_client_request_id' then 'gen_random_uuid()' else 'null::' || format_type(a.t, null) end, ', ' order by a.o)
             from unnest(p.proargtypes, coalesce(p.proargnames[1:p.pronargs], array_fill(''::text, array[p.pronargs]))) with ordinality a(t, n, o)) as args
    from expected e join pg_proc p on p.proname = e.fn join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  loop
    q := format('select public.%I(%s)', f.proname, coalesce(f.args, ''));
    for w in select * from who loop
      perform set_config('request.jwt.claim.sub', coalesce(w.uid::text, ''), true);
      execute 'set local role ' || w.db_role;
      v_state := null; v_msg := null;
      begin
        execute q;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      end;
      reset role;
      insert into result values (f.fn, w.code, coalesce(v_state = '42501' or v_msg ~* '(do not have|don''t have) permission|only (an )?administrator', false), v_state || ' ' || left(v_msg, 60));
    end loop;
  end loop;
end $$;

\pset tuples_only on
\pset format unaligned
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' permissions: every listed function exists (' || (select count(*) from expected) || ' functions)'
  || coalesce(': missing ' || string_agg(fn, ', '), '')
  from expected e where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = e.fn);
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' permissions: each role may call what it should, checked with ' || (select count(distinct who) from result) || ' real accounts'
  || coalesce(': ' || string_agg(r.fn || ' ' || r.who || (case when r.refused then ' was refused' else ' was allowed (' || coalesce(r.detail, 'ran') || ')' end), '; '), '')
  from result r join expected e on e.fn = r.fn where r.refused = (r.who = any(e.allowed));
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' permissions: inactive accounts, accounts that must choose a new password, and signed-out callers are refused everywhere'
  from result where who in ('inactive', 'new_password', 'signed_out') and not refused;
-- Functions anyone signed out could run (Supabase grants anon by default).
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' permissions: nothing that changes data runs signed out'
  || coalesce(': ' || string_agg(p.proname, ', '), '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.provolatile = 'v' and p.prorettype <> 'trigger'::regtype
    and p.proname not in (select fn from expected)
    and p.proname not in ('create_order_with_items', 'create_duplicate_order_with_items', 'transition_order_status', 'set_order_attention',
      'update_preparation_status', 'create_delivery', 'reschedule_delivery', 'update_delivery_status');
rollback;
