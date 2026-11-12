#!/usr/bin/env bash
# Two phones at once: office staff reassign a stop while the driver saves a
# new order for their route. The route save must wait for the reassignment
# and then refuse, never saving an order that includes a stop no longer on
# the route. Then two reassignments of one stop at once: both finish, the
# last one wins, and the stop is never on two routes.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../local_only.sh"
DB=${DB:-meah_test}
q() { psql -v ON_ERROR_STOP=1 -Atq -d "$DB" "$@"; }
pass() { echo "NOTICE:  PASS $1"; }
fail() { echo "NOTICE:  FAIL $1"; exit 1; }

q <<'SQL' >/dev/null
delete from public.mutation_requests;
delete from public.order_activity where order_id in (select id from public.orders where notes = 'parallel-test');
delete from public.deliveries where order_id in (select id from public.orders where notes = 'parallel-test');
delete from public.order_items where order_id in (select id from public.orders where notes = 'parallel-test');
delete from public.orders where notes = 'parallel-test';
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000006c1', 'office6@meah.test', '{"full_name":"Office"}'),
  ('00000000-0000-0000-0000-0000000006a1', 'admin6@meah.test', '{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000006d1', 'rico6@meah.test', '{"full_name":"Rico"}'),
  ('00000000-0000-0000-0000-0000000006d2', 'jun6@meah.test', '{"full_name":"Jun"}')
on conflict do nothing;
update public.profiles set status = 'active', role = 'administrative_staff' where id = '00000000-0000-0000-0000-0000000006c1';
update public.profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000006a1';
update public.profiles set status = 'active', role = 'delivery_staff' where id in ('00000000-0000-0000-0000-0000000006d1', '00000000-0000-0000-0000-0000000006d2');
insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-0000000006c0', 'C-P6', 'Parallel') on conflict do nothing;
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date, notes) values
  ('00000000-0000-0000-0000-0000000006e1', '00000000-0000-0000-0000-0000000006c0', 'phone', '00000000-0000-0000-0000-0000000006c1', 'for_delivery', current_date, 'parallel-test'),
  ('00000000-0000-0000-0000-0000000006e2', '00000000-0000-0000-0000-0000000006c0', 'phone', '00000000-0000-0000-0000-0000000006c1', 'for_delivery', current_date, 'parallel-test');
insert into public.deliveries (id, order_id, assigned_driver_id, scheduled_date, route_position) values
  ('00000000-0000-0000-0000-0000000006f1', '00000000-0000-0000-0000-0000000006e1', '00000000-0000-0000-0000-0000000006d1', current_date, 1),
  ('00000000-0000-0000-0000-0000000006f2', '00000000-0000-0000-0000-0000000006e2', '00000000-0000-0000-0000-0000000006d1', current_date, 2);
SQL

as_user() { echo "select set_config('request.jwt.claim.sub', '$1', true); set local role authenticated;"; }

# 1. Office reassigns stop 2 to Jun and holds the transaction open; Rico saves
#    [2, 1] at the same moment.
out1=$(mktemp); out2=$(mktemp)
( q -c "begin; $(as_user 00000000-0000-0000-0000-0000000006c1) select public.assign_delivery_driver('00000000-0000-0000-0000-0000000006f2', '00000000-0000-0000-0000-0000000006d2', gen_random_uuid()); select pg_sleep(1); commit;" >"$out1" 2>&1 ) &
sleep 0.3
( q -c "begin; $(as_user 00000000-0000-0000-0000-0000000006d1) select public.reorder_route(current_date, '00000000-0000-0000-0000-0000000006d1', array['00000000-0000-0000-0000-0000000006f2', '00000000-0000-0000-0000-0000000006f1']::uuid[], gen_random_uuid()); commit;" >"$out2" 2>&1 ) &
wait || true
grep -q "This route changed while you were editing" "$out2" && pass "a route save that overlaps a reassignment waits, then is refused" || { cat "$out2"; fail "route save during reassignment was not refused"; }
[ "$(q -c "select assigned_driver_id from public.deliveries where id = '00000000-0000-0000-0000-0000000006f2'")" = "00000000-0000-0000-0000-0000000006d2" ] && pass "the reassignment stands" || fail "the reassignment was lost"
[ "$(q -c "select route_position from public.deliveries where id = '00000000-0000-0000-0000-0000000006f1'")" = "1" ] && pass "Rico's remaining stop keeps its place" || fail "Rico's stop moved"

# 2. Two people reassign stop 1 at once (to Jun, and off any driver).
( q -c "begin; $(as_user 00000000-0000-0000-0000-0000000006c1) select public.assign_delivery_driver('00000000-0000-0000-0000-0000000006f1', '00000000-0000-0000-0000-0000000006d2', gen_random_uuid()); select pg_sleep(0.6); commit;" >"$out1" 2>&1 ) &
sleep 0.2
( q -c "begin; $(as_user 00000000-0000-0000-0000-0000000006a1) select public.assign_delivery_driver('00000000-0000-0000-0000-0000000006f1', null, gen_random_uuid()); commit;" >"$out2" 2>&1 ) &
wait || true
if grep -q ERROR "$out1" "$out2"; then cat "$out1" "$out2"; fail "a simultaneous reassignment failed"; fi
[ "$(q -c "select coalesce(assigned_driver_id::text, 'none') from public.deliveries where id = '00000000-0000-0000-0000-0000000006f1'")" = "none" ] && pass "two reassignments at once: the later one wins" || fail "unexpected driver after two reassignments"
[ "$(q -c "select count(*) from public.order_activity where action = 'driver_assigned' and details->>'delivery_id' = '00000000-0000-0000-0000-0000000006f1'")" = "2" ] && pass "both reassignments are logged" || fail "reassignments not logged"

# 3. The driver taps Delivered twice at once with the same request id: one result, one receipt.
rid=$(q -c "select gen_random_uuid()")
q -c "update public.deliveries set assigned_driver_id = '00000000-0000-0000-0000-0000000006d2' where id = '00000000-0000-0000-0000-0000000006f1'" >/dev/null
for i in 1 2; do
  ( q -c "begin; $(as_user 00000000-0000-0000-0000-0000000006d2) select public.complete_delivery('00000000-0000-0000-0000-0000000006f1', 'Joy', '$rid', tests.pv_delivery('00000000-0000-0000-0000-0000000006f1')); select pg_sleep(0.4); commit;" >"$out1.$i" 2>&1 ) &
done
wait || true
[ "$(q -c "select count(*) from public.delivery_receipts where order_id = '00000000-0000-0000-0000-0000000006e1'")" = "1" ] && pass "two simultaneous Delivered taps issue one receipt" || { cat "$out1".*; fail "duplicate receipts"; }
[ "$(q -c "select count(*) from public.order_activity where order_id = '00000000-0000-0000-0000-0000000006e1' and details->>'to_status' = 'completed' and action = 'status_changed'")" = "1" ] && pass "and complete the order once" || fail "order completed twice"
rm -f "$out1" "$out2" "$out1".*
