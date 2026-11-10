#!/usr/bin/env bash
# Ten wrong attempts for one account at the same moment: exactly five may reach
# the password check; the rest are refused by the lockout row lock.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../local_only.sh"
DB=${DB:-meah_test}
psql -q -d "$DB" -c "delete from public.login_guard where key = 'user:parallel'" >/dev/null
out=$(mktemp)
for i in $(seq 1 10); do
  # Each call holds its transaction open briefly, as a slow password check would.
  psql -Atq -d "$DB" -c "begin; select allowed from public.reserve_login_attempt('user:parallel'); select pg_sleep(0.3); commit;" >>"$out" &
done
wait
allowed=$(grep -c '^t$' "$out" || true)
refused=$(grep -c '^f$' "$out" || true)
rm -f "$out"
if [ "$allowed" -eq 5 ] && [ "$refused" -eq 5 ]; then
  echo "NOTICE:  PASS 10 parallel attempts: exactly 5 allowed, 5 refused"
else
  echo "NOTICE:  FAIL 10 parallel attempts: $allowed allowed, $refused refused"
  exit 1
fi
