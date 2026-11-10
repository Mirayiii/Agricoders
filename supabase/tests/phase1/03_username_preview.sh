#!/usr/bin/env bash
# The username preview shows proposals and saves nothing. Builds its own
# database (migrations only, no go-live scripts) with accounts that still have
# placeholder usernames, as the live project will have after Migration A.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../local_only.sh"
cd "$(dirname "$0")/../../.."
gl=supabase/go-live/phase1
# 1. The preview is 01_username_backfill.sql wrapped in BEGIN ... ROLLBACK.
expected=$(sed '/^select public.backfill_usernames() as accounts_given_a_username;$/d' $gl/01_username_backfill.sql)
grep -qF "$(echo "$expected" | sed -n '20,40p')" $gl/00_preview_usernames.sql || { echo "FAIL 00_preview_usernames.sql is out of step with 01"; exit 1; }
tail -n 3 $gl/00_preview_usernames.sql | grep -q '^rollback;$' || { echo "FAIL preview does not end with rollback"; exit 1; }

DB=meah_preview
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/local_supabase_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do
  sed -E -e 's/order by p.product_name, sku( |;)/order by p.product_name, 2\1/' -e 's/order by ps.product_id, sku;/order by ps.product_id, 3;/' "$f" | psql -q -v ON_ERROR_STOP=1 -d $DB >/dev/null
done
psql -q -v ON_ERROR_STOP=1 -d $DB >/dev/null <<'SQL'
insert into auth.users (email, raw_user_meta_data) values
  ('Maria.Santos@meah.test', '{"full_name":"Maria Santos"}'),
  ('maria.santos@other.test', '{"full_name":"Maria Santos 2"}'),
  ('9jun@meah.test', '{"full_name":"Jun"}');
SQL
before=$(psql -tA -d $DB -c "select string_agg(username, ',' order by username) from profiles")
out=$(psql -v ON_ERROR_STOP=1 -tA -d $DB -f $gl/00_preview_usernames.sql)
after=$(psql -tA -d $DB -c "select string_agg(username, ',' order by username) from profiles")
[ "$before" = "$after" ] || { echo "FAIL preview changed usernames"; exit 1; }
[ "$(psql -tA -d $DB -c "select to_regclass('public.username_migration_report') is null")" = "t" ] || { echo "FAIL preview left the report table"; exit 1; }
echo "$out" | grep -q '|maria.santos|' && echo "$out" | grep -q '|maria.santos2|' && echo "$out" | grep -q '|u9jun|' \
  || { echo "FAIL unexpected proposals:"; echo "$out"; exit 1; }
echo "NOTICE:  PASS username preview lists proposals and saves nothing"
