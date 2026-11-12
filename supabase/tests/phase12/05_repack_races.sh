#!/usr/bin/env bash
# Two phones at once on a packed order (Jac, 5 Nov 2026): an edit racing a
# completion, a packing tick and a departure. Every pair must run one after
# the other (the order row is locked first), and the second must see the
# first's result: no completion of a changed order, no tick from an old list,
# no item change once the order has left.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../local_only.sh"
DB=${DB:-meah_test}
q() { psql -v ON_ERROR_STOP=1 -Atq -d "$DB" "$@"; }
pass() { echo "NOTICE:  PASS $1"; }
fail() { echo "NOTICE:  FAIL $1"; exit 1; }
as_user() { echo "select set_config('request.jwt.claim.sub', '$1', true); set local role authenticated;"; }
OFFICE=00000000-0000-0000-0000-0000000015c1
PACKER=00000000-0000-0000-0000-0000000015f1
DRIVER=00000000-0000-0000-0000-0000000015d1

# Each scenario gets its own orders (n = 1..5), so nothing needs deleting.
setup() {
n=$2
E1=00000000-0000-0000-0000-00000015${n}0e1; E2=00000000-0000-0000-0000-00000015${n}0e2
B1=00000000-0000-0000-0000-00000015${n}0b1; B2=00000000-0000-0000-0000-00000015${n}0b2
B3=00000000-0000-0000-0000-00000015${n}0b3; B4=00000000-0000-0000-0000-00000015${n}0b4
D2=00000000-0000-0000-0000-00000015${n}0d2
q <<SQL >/dev/null
insert into auth.users (id, email, raw_user_meta_data) values
  ('$OFFICE', 'office15@meah.test', '{"full_name":"Office"}'),
  ('$PACKER', 'packer15@meah.test', '{"full_name":"Packer"}'),
  ('$DRIVER', 'driver15@meah.test', '{"full_name":"Driver"}')
on conflict do nothing;
update public.profiles set status = 'active', role = 'administrative_staff' where id = '$OFFICE';
update public.profiles set status = 'active', role = 'fulfillment_staff' where id = '$PACKER';
update public.profiles set status = 'active', role = 'delivery_staff' where id = '$DRIVER';
insert into public.customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000c151', 'R15-001', 'Race Foods') on conflict do nothing;
insert into public.products (id, product_name, unit_of_measurement) values
  ('00000000-0000-0000-0000-00000000b151', 'R15 Onions', 'kg'), ('00000000-0000-0000-0000-00000000b152', 'R15 Garlic', 'kg') on conflict do nothing;
-- e1: packed, waiting for delivery. e2: being packed, one line ticked.
insert into public.orders (id, customer_id, order_source, encoded_by, status, requested_delivery_date, notes) values
  ('$E1', '00000000-0000-0000-0000-00000000c151', 'phone', '$OFFICE', '$1', current_date + 1, 'repack-race'),
  ('$E2', '00000000-0000-0000-0000-00000000c151', 'phone', '$OFFICE', 'for_preparation', current_date + 1, 'repack-race');
insert into public.order_items (id, order_id, product_id, quantity, unit_of_measurement, unit_price, original_unit_price, cost_price, preparation_status) values
  ('$B1', '$E1', '00000000-0000-0000-0000-00000000b151', 4, 'kg', 100, 100, 60, 'completed'),
  ('$B2', '$E1', '00000000-0000-0000-0000-00000000b152', 2, 'kg', 50, 50, 30, 'completed'),
  ('$B3', '$E2', '00000000-0000-0000-0000-00000000b151', 4, 'kg', 100, 100, 60, 'completed'),
  ('$B4', '$E2', '00000000-0000-0000-0000-00000000b152', 2, 'kg', 50, 50, 30, 'pending');
insert into public.deliveries (id, order_id, assigned_driver_id, scheduled_date) values
  ('$D2', '$E1', '$DRIVER', current_date + 1);
SQL
}
# The office changes the garlic to $2 kg on order $1, holding the transaction open for $3 s.
edit_sql() {
  echo "begin; $(as_user $OFFICE) select public.edit_order_with_items('$1', jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c151', 'requested_delivery_date', current_date + 1, 'notes', 'repack-race'),
    '[{\"product_id\":\"00000000-0000-0000-0000-00000000b151\",\"quantity\":4,\"unit_of_measurement\":\"kg\"},{\"product_id\":\"00000000-0000-0000-0000-00000000b152\",\"quantity\":$2,\"unit_of_measurement\":\"kg\"}]'::jsonb); select pg_sleep($3); commit;"
}
deliver_sql() { echo "begin; $(as_user $DRIVER) select public.complete_delivery('$D2', null, gen_random_uuid(), 1); select pg_sleep($1); commit;"; }
out1=$(mktemp); out2=$(mktemp)
st() { q -c "select status from public.orders where id = '$1'"; }

# 1. An edit and a completion at the same moment, the edit first.
setup for_delivery 1
( q -c "$(edit_sql $E1 3 1)" >"$out1" 2>&1 ) &
sleep 0.3
( q -c "$(deliver_sql 0)" >"$out2" 2>&1 ) &
wait || true
grep -q "This order is being repacked after a change" "$out2" && pass "race: a completion during an edit waits, then is refused (order being repacked)" || { cat "$out1" "$out2"; fail "completion during an edit was not refused"; }
[ "$(st $E1)" = "for_preparation" ] && pass "race: the edit stands and the order is in Packing" || fail "the edit was lost"

# 2. The same, the completion first: the edit waits, then finds the order completed.
setup for_delivery 2
( q -c "$(deliver_sql 1)" >"$out1" 2>&1 ) &
sleep 0.3
( q -c "$(edit_sql $E1 3 0)" >"$out2" 2>&1 ) &
wait || true
grep -q "Completed and cancelled orders can't be edited" "$out2" && pass "race: an edit during a completion waits, then is refused (order completed)" || { cat "$out1" "$out2"; fail "edit during a completion was not refused"; }
[ "$(q -c "select quantity from public.order_items where id = '$B2'")" = "2.000" ] && pass "race: the delivered items are unchanged" || fail "delivered items changed"

# 3. A packing tick from a list loaded before an edit of the same order.
setup for_delivery 3
( q -c "$(edit_sql $E2 3 1)" >"$out1" 2>&1 ) &
sleep 0.3
( q -c "begin; $(as_user $PACKER) select public.set_item_packed('$B4', true, gen_random_uuid(), 1); commit;" >"$out2" 2>&1 ) &
wait || true
grep -q "changed after this screen was loaded" "$out2" && pass "race: a tick during an edit waits, then is refused (old list)" || { cat "$out1" "$out2"; fail "tick during an edit was not refused"; }
[ "$(q -c "select preparation_status from public.order_items where id = '$B4'")" = "pending" ] && pass "race: the changed line stays unpacked" || fail "the changed line was ticked"

# 4. The driver leaves while an item edit is being saved, the departure first.
setup for_delivery 4
( q -c "begin; $(as_user $DRIVER) select public.update_delivery_status('$D2', 'for_delivery'); select pg_sleep(1); commit;" >"$out1" 2>&1 ) &
sleep 0.3
( q -c "$(edit_sql $E1 3 0)" >"$out2" 2>&1 ) &
wait || true
grep -q "already out for delivery" "$out2" && pass "race: an item edit during departure waits, then is refused (out for delivery)" || { cat "$out1" "$out2"; fail "edit during departure was not refused"; }

# 5. The edit first: the departure waits, then finds the order back in Packing.
setup for_delivery 5
( q -c "$(edit_sql $E1 3 1)" >"$out1" 2>&1 ) &
sleep 0.3
( q -c "begin; $(as_user $DRIVER) select public.update_delivery_status('$D2', 'for_delivery'); commit;" >"$out2" 2>&1 ) &
wait || true
grep -q "The order must complete preparation before delivery starts" "$out2" && pass "race: a departure during an edit waits, then is refused (repacking)" || { cat "$out1" "$out2"; fail "departure during an edit was not refused"; }
[ "$(q -c "select status from public.deliveries where id = '$D2'")" = "scheduled" ] && pass "race: the stop has not left" || fail "the stop left during repacking"

if grep -q deadlock "$out1" "$out2"; then fail "a deadlock happened"; fi
# Leave the shared test database as it was for the files that run after this one.
q <<'SQL' >/dev/null
set session_replication_role = replica;
delete from public.delivery_receipts where order_id in (select id from public.orders where notes = 'repack-race');
delete from public.order_item_removals where order_id in (select id from public.orders where notes = 'repack-race');
delete from public.order_activity where order_id in (select id from public.orders where notes = 'repack-race');
delete from public.notifications where related_order_id in (select id from public.orders where notes = 'repack-race');
delete from public.deliveries where order_id in (select id from public.orders where notes = 'repack-race');
delete from public.order_items where order_id in (select id from public.orders where notes = 'repack-race');
delete from public.orders where notes = 'repack-race';
delete from public.products where id in ('00000000-0000-0000-0000-00000000b151', '00000000-0000-0000-0000-00000000b152');
delete from public.customers where id = '00000000-0000-0000-0000-00000000c151';
delete from public.mutation_requests;
delete from public.profiles where id in ('00000000-0000-0000-0000-0000000015c1', '00000000-0000-0000-0000-0000000015f1', '00000000-0000-0000-0000-0000000015d1');
delete from auth.users where id in ('00000000-0000-0000-0000-0000000015c1', '00000000-0000-0000-0000-0000000015f1', '00000000-0000-0000-0000-0000000015d1');
SQL
rm -f "$out1" "$out2"
