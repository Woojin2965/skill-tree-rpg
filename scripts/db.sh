#!/bin/sh
# Local Postgres on port 5433, stored in .pgdata. Production uses Neon.
set -eu
PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
cd "$(dirname "$0")/.."
export PGHOST=localhost PGPORT=5433 PGUSER=postgres LC_ALL=en_US.UTF-8

case "${1:-}" in
  start)
    [ -d .pgdata ] || initdb -D .pgdata -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
    pg_ctl -D .pgdata -o "-p 5433 -c listen_addresses=localhost" -l .pgdata/server.log -w start
    ;;
  stop)
    pg_ctl -D .pgdata stop
    ;;
  reset)
    .venv/bin/python scripts/generate_seed.py
    dropdb --if-exists knowledge_rpg
    createdb knowledge_rpg
    for file in db/migrations/*.sql db/seed.sql; do
      psql -q -v ON_ERROR_STOP=1 -d knowledge_rpg -f "$file"
    done
    ;;
  deploy)
    # First load into an empty production database. Needs PROD_DATABASE_URL (Neon) in the environment.
    url="${PROD_DATABASE_URL:?PROD_DATABASE_URL is not set}"
    unset PGHOST PGPORT PGUSER
    case "$url" in *localhost*|*127.0.0.1*) echo "refusing a local URL" >&2; exit 1 ;; esac
    [ -f db/seed.sql ] || .venv/bin/python scripts/generate_seed.py
    if [ "$(psql "$url" -Atc "SELECT to_regclass('public.skills') IS NOT NULL")" = t ]; then
      echo "database already has tables; apply new migrations by hand" >&2
      exit 1
    fi
    for file in db/migrations/*.sql db/seed.sql; do
      psql "$url" -q -v ON_ERROR_STOP=1 -f "$file"
    done
    ;;
  *)
    echo "usage: $0 start|stop|reset|deploy" >&2
    exit 1
    ;;
esac
