#!/usr/bin/env bash
# Per-boot reconciliation: bring up the local PostgreSQL control-plane database.
# Idempotent and safe to run on every start.
set -euo pipefail

PGDATA="${PGDATA:-$HOME/.pgdata}"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
export PATH="${PGBIN}:${PATH}"

# Initialize the cluster once (trust auth is scoped to this local dev database).
if [ ! -s "${PGDATA}/PG_VERSION" ]; then
  initdb -D "${PGDATA}" -U postgres --auth=trust -E UTF8 >/tmp/initdb.log 2>&1
fi

# Start the server only if it is not already running.
if ! pg_ctl -D "${PGDATA}" status >/dev/null 2>&1; then
  pg_ctl -D "${PGDATA}" -l "${PGDATA}/logfile" -o "-p 5432 -k /tmp" -w start
fi

# Ensure the application database exists (migrations run from the app on boot).
createdb -h localhost -p 5432 -U postgres kb_maintainer 2>/dev/null || true

echo "PostgreSQL ready on localhost:5432 (database: kb_maintainer)"
