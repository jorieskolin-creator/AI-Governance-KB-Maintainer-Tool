#!/usr/bin/env bash
# Per-boot startup: bring up the local PostgreSQL control-plane database.
#
# The Fastify dev server runs separately in the `dev-server` terminal
# (see .cursor/environment.json) and applies migrations on boot.
# This script is idempotent and safe to re-run.
set -euo pipefail

# The default branch is a bare skeleton without the application; only bring up
# the database when the app is actually checked out on this branch.
if [ ! -f package.json ]; then
  echo "No package.json in $(pwd); skipping database startup."
  exit 0
fi

PGDATA="${PGDATA:-$HOME/.pgdata}"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
if [ -z "${PGBIN}" ]; then
  echo "PostgreSQL server binaries not found under /usr/lib/postgresql/*/bin" >&2
  exit 1
fi
export PATH="${PGBIN}:${PATH}"
export PGDATA

# Initialize the cluster once (trust auth scoped to this local dev database).
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
