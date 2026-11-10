#!/usr/bin/env bash
# Upgrade path: a database built from every migration before Phase 3, holding
# orders with fractional quantities, then the Phase 3 migration.
#
# Regression for the money policy: orders that existed before Phase 3 keep the
# exact totals every report showed before (no centavo drift), because they are
# marked money_rounding = 'order_sum'. Orders created afterwards round each line
# to two decimals first ('line').
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../local_only.sh"
cd "$(dirname "$0")/../../.."
DB=meah_upgrade3
phase3=supabase/migrations/202611030002_phase3_orders.sql
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/local_supabase_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do
  [ "$f" \< "$phase3" ] || continue
  sed -E -e 's/order by p.product_name, sku( |;)/order by p.product_name, 2\1/' -e 's/order by ps.product_id, sku;/order by ps.product_id, 3;/' "$f" | psql -q -v ON_ERROR_STOP=1 -d $DB >/dev/null
done
psql -q -v ON_ERROR_STOP=1 -d $DB >/dev/null <<'SQL'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'admin@meah.test');
update profiles set status = 'active', role = 'administrator' where id = '00000000-0000-0000-0000-0000000000a1';
insert into customers (id, customer_code, business_name) values ('00000000-0000-0000-0000-00000000c001', 'C-001', 'Casa Verde');
insert into products (id, product_name) values ('00000000-0000-0000-0000-00000000b001', 'Tomatoes');
insert into price_history (product_id, cost_price, selling_price, effective_from, created_by) values ('00000000-0000-0000-0000-00000000b001', 60.25, 85.50, now() - interval '1 day', '00000000-0000-0000-0000-0000000000a1');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
-- Order 1: whole and half quantities plus a special price.
select create_order_with_items(jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c001', 'order_source', 'viber', 'requested_delivery_date', current_date),
  '[{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":2.5,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":1,"unit_of_measurement":"kg","special_price":80,"special_price_reason":"Promo"}]'::jsonb);
-- Order 2: fractional quantities where rounding each line would differ from
-- the old sum: 0.333 x 85.50 = 28.4715 twice is 56.943 unrounded, 56.94 by line.
select create_order_with_items(jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c001', 'order_source', 'phone', 'requested_delivery_date', current_date + 1),
  '[{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":0.333,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":0.333,"unit_of_measurement":"kg"}]'::jsonb);
SQL
# Everything a report or the app shows about money, as text.
snapshot() {
  psql -qtA -v ON_ERROR_STOP=1 -d $DB <<'SQL'
select 'items', string_agg(unit_price::text || '/' || original_unit_price::text || '/' || coalesce(special_price::text, '-'), ',' order by quantity, unit_price) from order_items;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
set role authenticated;
select 'order_report', order_number, total, item_count, total_rows from get_order_report() order by order_number;
select 'customer_report', r::text from get_customer_report() r;
select 'customer_history', h::text from get_customer_order_history('00000000-0000-0000-0000-00000000c001') h order by h::text;
select 'margin', m::text from get_order_margin_summary() m;
SQL
}
before=$(snapshot)
psql -q -v ON_ERROR_STOP=1 -d $DB -f $phase3 >/dev/null
after=$(snapshot)
[ "$before" = "$after" ] || { echo "FAIL old orders' report output changed after the Phase 3 migration"; diff <(echo "$before") <(echo "$after") || true; exit 1; }
echo "$before" | grep -q '56.943' || { echo "FAIL the fixture did not produce a fractional total (expected 56.943)"; echo "$before"; exit 1; }

check=$(psql -qtA -v ON_ERROR_STOP=1 -d $DB <<'SQL'
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
set role authenticated;
select (select string_agg(money_rounding, ',' order by order_number) from orders)
  || '|' || (select string_agg(order_total(o)::text, ',' order by order_number) from orders o)
  || '|' || (select count(*)::text from orders where discount_type is null and sales_invoice_number is null)
  -- The current app's Orders and Order detail queries still run.
  || '|' || (select count(*)::text from (select o.id, o.order_number, o.status, o.requires_attention, oi.quantity, oi.unit_price from orders o join order_items oi on oi.order_id = o.id) q);
SQL
)
expected="order_sum,order_sum|293.75000,56.94300|2|4"
[ "$check" = "$expected" ] || { echo "FAIL upgrade state: $check (expected $expected)"; exit 1; }

# A new order placed after the migration uses the new policy: each line is
# rounded to two decimals, so the same items total 56.94.
new=$(psql -qtA -v ON_ERROR_STOP=1 -d $DB <<'SQL'
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
set role authenticated;
select create_order_with_items(jsonb_build_object('customer_id', '00000000-0000-0000-0000-00000000c001', 'order_source', 'phone', 'requested_delivery_date', current_date + 2),
  '[{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":0.333,"unit_of_measurement":"kg"},{"product_id":"00000000-0000-0000-0000-00000000b001","quantity":0.333,"unit_of_measurement":"kg"}]'::jsonb) is null;
select money_rounding || '|' || order_total(x)::text from orders x order by created_at desc, order_number desc limit 1;
SQL
)
[ "$new" = "f
line|56.94" ] || { echo "FAIL new orders should round by line: $new"; exit 1; }

# The old orders are still unchanged in the reports after new orders arrive.
old_report=$(psql -qtA -d $DB -c "set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1'" -c "set role authenticated" -c "select order_number, total from get_order_report() where total::text in ('293.75000','56.94300') order by order_number")
[ "$(echo "$old_report" | grep -c '|')" = 2 ] || { echo "FAIL old totals moved after new orders: $old_report"; exit 1; }

# Applying the migration twice is harmless and still leaves old orders alone.
psql -q -v ON_ERROR_STOP=1 -d $DB -f $phase3 >/dev/null 2>&1 || { echo "FAIL Phase 3 migration is not safe to re-run"; exit 1; }
again=$(psql -qtA -d $DB -c "select string_agg(money_rounding, ',' order by order_number) from orders")
[ "$again" = "order_sum,order_sum,line" ] || { echo "FAIL re-running the migration changed the rounding policy: $again"; exit 1; }
psql -q -d postgres -c "drop database $DB" >/dev/null
echo "NOTICE:  PASS upgrade keeps old orders' prices and every report total to the centavo (fractional quantities too)"
echo "NOTICE:  PASS orders created after the upgrade round each line to two decimals"
echo "NOTICE:  PASS the current app's queries still work and the migration is safe to re-run"
