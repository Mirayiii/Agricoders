#!/usr/bin/env bash
# Checks the "order by sku" fix two ways, on a local PostgreSQL:
#  1. fresh: every migration in order on an empty database;
#  2. upgrade: the database as it was before (the three functions created from
#     the old, broken text with body checks off, as a hosted project may have
#     them), with data in it, then the fix migration.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/fix_sku_order/run.sh
# PGHOST must be this computer (a socket path, localhost or 127.0.0.1).
set -euo pipefail
cd "$(dirname "$0")/../../.."
# This script drops and recreates databases: only ever on this computer.
case "${PGHOST:-}" in
  ""|/*|localhost|127.0.0.1|::1) ;;
  *) echo "Refusing to run: PGHOST=$PGHOST is not a local database server." >&2; exit 2 ;;
esac
if [ -n "${DATABASE_URL:-}${PGSERVICE:-}" ]; then
  echo "Refusing to run: unset DATABASE_URL and PGSERVICE." >&2; exit 2
fi
here=supabase/tests/fix_sku_order
# After the later phases merge, their migrations need more of Supabase's auth
# schema than this folder's stub has, so use the shared stub when it exists.
STUB=$here/stub.sql
[ -f supabase/tests/local_supabase_stub.sql ] && STUB=supabase/tests/local_supabase_stub.sql
# The broken text comes from main as it was before this fix (16a8149), so the
# upgrade check still works after the fix is merged into main.
OLD=16a8149
FIX=202611020001_fix_sku_order_by.sql
q() { psql -q -v ON_ERROR_STOP=1 -d "$1" "${@:2}" >/dev/null; }
fresh() { psql -q -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null; q "$1" -f $STUB; }

echo "== fresh database"
fresh meah_fix_fresh
for f in supabase/migrations/*.sql; do q meah_fix_fresh -f "$f"; done
q meah_fix_fresh -f $here/seed.sql
psql -q -v ON_ERROR_STOP=1 -d meah_fix_fresh -f $here/checks.sql 2>&1 | grep -E "PASS|FAIL|ERROR"

echo "== upgrade from the previous schema"
fresh meah_fix_upgrade
for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  [ "$name" = "$FIX" ] && continue
  if [ "$name" = 202609240011_reports_notifications_performance.sql ] || [ "$name" = 202609250001_inventory_management.sql ]; then
    # The previous, broken text of these files, with body checks off.
    { echo "set check_function_bodies = off;"; git show "$OLD:$f"; } | q meah_fix_upgrade
  else
    q meah_fix_upgrade -f "$f"
  fi
done
q meah_fix_upgrade -f $here/seed.sql
before=$(psql -tA -d meah_fix_upgrade -c "select count(*) from public.products")
# The old functions fail when called.
if psql -q -d meah_fix_upgrade -c "select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); select * from public.get_inventory_list()" >/dev/null 2>&1; then
  echo "FAIL the old get_inventory_list unexpectedly works"; exit 1
fi
echo "PASS the old functions fail before the fix"
q meah_fix_upgrade -f supabase/migrations/$FIX
after=$(psql -tA -d meah_fix_upgrade -c "select count(*) from public.products")
[ "$before" = "$after" ] || { echo "FAIL rows changed"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d meah_fix_upgrade -f $here/checks.sql 2>&1 | grep -E "PASS|FAIL|ERROR"
