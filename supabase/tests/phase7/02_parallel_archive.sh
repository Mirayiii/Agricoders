#!/usr/bin/env bash
# Two phones at once: one person archives a customer while another saves a
# new order for them. Whichever starts first wins; an order is never created
# for a customer who ends up archived by an archive that ran before it. Then
# two edits of the same customer at once: both finish, the later one wins,
# and both are logged.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../local_only.sh"
DB=${DB:-meah_test}
q() { psql -v ON_ERROR_STOP=1 -Atq -d "$DB" "$@"; }
pass() { echo "NOTICE:  PASS $1"; }
fail() { echo "NOTICE:  FAIL $1"; exit 1; }

C=00000000-0000-0000-0000-0000000007c9
OFFICE=00000000-0000-0000-0000-0000000007c8
ADMIN=00000000-0000-0000-0000-0000000007a8
q <<SQL >/dev/null
insert into auth.users (id, email, raw_user_meta_data) values
  ('$OFFICE', 'office7p@meah.test', '{"full_name":"Office"}'),
  ('$ADMIN', 'admin7p@meah.test', '{"full_name":"Admin"}')
on conflict do nothing;
update public.profiles set status = 'active', role = 'administrative_staff' where id = '$OFFICE';
update public.profiles set status = 'active', role = 'administrator' where id = '$ADMIN';
insert into public.customers (id, customer_code, business_name) values ('$C', 'P7-PAR', 'Parallel Grocers') on conflict do nothing;
update public.customers set status = 'active' where id = '$C';
insert into public.products (id, product_name, unit_of_measurement) values ('00000000-0000-0000-0000-0000000007b9', 'P7 Parallel Onions', 'kg') on conflict do nothing;
insert into public.price_history (product_id, cost_price, selling_price, effective_from, created_by)
  select '00000000-0000-0000-0000-0000000007b9', 50, 80, now() - interval '1 day', '$ADMIN'
  where not exists (select 1 from public.price_history where product_id = '00000000-0000-0000-0000-0000000007b9');
SQL

as_user() { echo "select set_config('request.jwt.claim.sub', '$1', true); set local role authenticated;"; }
order_sql() {
  echo "select public.create_order(jsonb_build_object('customer_id', '$C', 'requested_delivery_date', current_date + 1, 'order_source_id', (select id from public.order_sources where code = 'viber')), '[{\"product_id\":\"00000000-0000-0000-0000-0000000007b9\",\"quantity\":1,\"unit_of_measurement\":\"kg\"}]', gen_random_uuid());"
}
orders() { q -c "select count(*) from public.orders where customer_id = '$C'"; }
out1=$(mktemp); out2=$(mktemp)

# 1. The archive starts first and holds its transaction; the new order waits, then is refused.
before=$(orders)
( q -c "begin; $(as_user $ADMIN) select public.set_customer_archived('$C', true, gen_random_uuid()); select pg_sleep(1); commit;" >"$out1" 2>&1 ) &
sleep 0.3
( q -c "begin; $(as_user $OFFICE) $(order_sql) commit;" >"$out2" 2>&1 ) &
wait || true
grep -q "This customer is archived" "$out2" && pass "a new order saved while the customer is being archived waits, then is refused" || { cat "$out1" "$out2"; fail "new order during archive was not refused"; }
[ "$(orders)" = "$before" ] && pass "no order was created for the archived customer" || fail "an order slipped through"

# 2. The new order starts first and holds its transaction; the archive waits, then goes ahead.
q -c "update public.customers set status = 'active' where id = '$C'" >/dev/null
( q -c "begin; $(as_user $OFFICE) $(order_sql) select pg_sleep(1); commit;" >"$out1" 2>&1 ) &
sleep 0.3
( q -c "begin; $(as_user $ADMIN) select public.set_customer_archived('$C', true, gen_random_uuid()); commit;" >"$out2" 2>&1 ) &
wait || true
if grep -q ERROR "$out1" "$out2"; then cat "$out1" "$out2"; fail "order-then-archive failed"; fi
[ "$(orders)" = "$((before + 1))" ] && [ "$(q -c "select status from public.customers where id = '$C'")" = "archived" ] \
  && pass "an order saved first is kept, and the archive then goes ahead" || fail "unexpected result for order-then-archive"

# 3. Two people edit the customer at once: both finish, the later one wins, both are logged.
edit_sql() { echo "select public.save_customer('$C', '{\"customer_code\":\"P7-PAR\",\"business_name\":\"$1\"}', gen_random_uuid());"; }
( q -c "begin; $(as_user $OFFICE) $(edit_sql 'Parallel Grocers A') select pg_sleep(0.6); commit;" >"$out1" 2>&1 ) &
sleep 0.2
( q -c "begin; $(as_user $ADMIN) $(edit_sql 'Parallel Grocers B') commit;" >"$out2" 2>&1 ) &
wait || true
if grep -q ERROR "$out1" "$out2"; then cat "$out1" "$out2"; fail "a simultaneous edit failed"; fi
[ "$(q -c "select business_name from public.customers where id = '$C'")" = "Parallel Grocers B" ] && pass "two edits at once: the later one wins" || fail "unexpected name after two edits"
[ "$(q -c "select count(*) from public.customer_activity where customer_id = '$C' and action = 'updated'")" = "2" ] && pass "both edits are logged" || fail "edits not logged"
rm -f "$out1" "$out2"
