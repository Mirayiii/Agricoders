#!/usr/bin/env bash
# Applies every migration to a fresh local PostgreSQL database and runs the
# SQL tests. Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run_local.sh
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/local_only.sh"
cd "$(dirname "$0")/../.."
DB=meah_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; }
run supabase/tests/local_supabase_stub.sql
# Known issue in an already-shipped migration: ORDER BY uses an output-column
# name ("sku") that a SQL function body cannot see, so the file fails on a fresh
# database. Patched here only for local testing; see the Phase 1 PR notes.
fix() { sed -E -e 's/order by p.product_name, sku( |;)/order by p.product_name, 2\1/' -e 's/order by ps.product_id, sku;/order by ps.product_id, 3;/' "$1"; }
for f in supabase/migrations/*.sql; do
  fix "$f" | psql -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null
done
for f in supabase/go-live/phase1/*.sql; do [ -e "$f" ] && run "$f"; done
status=0
# Integration review: whole workflows and the permission matrix on the same
# database, then the upgrade of a database that already has data.
for f in supabase/tests/phase*/* supabase/tests/integration/workflow.sql supabase/tests/integration/permissions.sql supabase/tests/integration/upgrade.sh; do
  echo "== $f"
  case "$f" in
    *.sql)
      if ! psql -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >"$f.log" 2>&1; then status=1; fi
      grep -E "PASS|FAIL|ERROR" "$f.log" | sed 's/^psql:[^ ]* //' || true
      rm -f "$f.log" ;;
    *.sh) DB=$DB "$f" 2>/dev/null || status=1 ;;
  esac
done
exit $status
