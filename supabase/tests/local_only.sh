# Sourced by every database test script. These scripts drop and recreate
# databases and delete rows, so they refuse to run unless psql points at a
# database server on this computer (a socket path, localhost or 127.0.0.1).
# Never point them at production. There is no override.
case "${PGHOST:-}" in
  ""|/*|localhost|127.0.0.1|::1) ;;
  *) echo "Refusing to run: PGHOST=$PGHOST is not a local database server. These tests drop databases and delete data." >&2; exit 2 ;;
esac
if [ -n "${DATABASE_URL:-}${PGSERVICE:-}" ]; then
  echo "Refusing to run: unset DATABASE_URL and PGSERVICE; these tests only use a local server through PGHOST/PGPORT/PGUSER." >&2; exit 2
fi
