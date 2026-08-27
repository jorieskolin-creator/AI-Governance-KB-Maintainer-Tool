#!/usr/bin/env bash
# Per-boot startup for the AI Governance KB Maintainer Tool development environment.
#
# Brings up the local PostgreSQL control-plane database and then runs the Fastify
# dev server (which applies migrations on boot). Idempotent and safe to re-run.
#
# The base environment snapshot provides the PostgreSQL binaries and Node.js.
set -euo pipefail

# This branch may not contain the application (e.g. the default branch is a bare
# skeleton). Only start services when the app is actually checked out here.
if [ ! -f package.json ]; then
  echo "No package.json in $(pwd); skipping database and dev server startup."
  exit 0
fi

export DATABASE_URL="${DATABASE_URL:-postgres://postgres@localhost:5432/kb_maintainer}"
export PORT="${PORT:-3000}"

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

echo "PostgreSQL ready on localhost:5432 (database: kb_maintainer). Starting dev server on :${PORT}"
exec npm run dev
