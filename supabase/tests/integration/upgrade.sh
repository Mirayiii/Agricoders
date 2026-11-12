#!/usr/bin/env bash
# Upgrade with existing data: builds the schema as it is live today (the
# migrations before the rollout), fills it with legacy data, applies every
# rollout migration and the go-live scripts, then checks nothing moved and a
# legacy order still goes through the new workflow.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/integration/upgrade.sh
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../local_only.sh"
cd "$(dirname "$0")/../../.."
DB=${UPGRADE_DB:-meah_upgrade}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; }
fix() { sed -E -e 's/order by p.product_name, sku( |;)/order by p.product_name, 2\1/' -e 's/order by ps.product_id, sku;/order by ps.product_id, 3;/' "$1"; }
run supabase/tests/local_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  [[ "$(basename "$f")" < "202611" ]] && fix "$f" | psql -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null
done
run supabase/tests/integration/legacy_seed.sql
run supabase/tests/integration/upgrade_snapshot.sql
for f in supabase/migrations/*.sql; do
  [[ "$(basename "$f")" > "202611" ]] && run "$f"
done
for f in supabase/go-live/phase1/0[1-9]*.sql; do run "$f"; done
run supabase/tests/test_helpers.sql
out=$(psql -X -d "$DB" -f supabase/tests/integration/upgrade_checks.sql 2>&1; psql -X -d "$DB" -f supabase/tests/integration/upgrade_workflow.sql 2>&1)
echo "$out" | grep -E "PASS|FAIL|ERROR" | sed -e 's/^psql:[^ ]* //' -e 's/^NOTICE:  //'
if command -v node >/dev/null; then
  if node scripts/check-api-contract.mjs "$DB" >/tmp/contract.$$ 2>&1; then echo "PASS upgrade: every call the app makes matches the upgraded database ($(tail -1 /tmp/contract.$$))"; else echo "FAIL upgrade: API contract"; cat /tmp/contract.$$; out="$out FAIL"; fi
  rm -f /tmp/contract.$$
fi
! echo "$out" | grep -qE "FAIL|ERROR"
