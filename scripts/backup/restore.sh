#!/bin/sh
# Restore a dump written by the staging backup service.
#
#   scripts/backup/restore.sh <file.dump> <target-db>                 # new DB
#   scripts/backup/restore.sh <file.dump> <live-db> --replace-live    # replace
#
# Run on the staging host from the checkout. The default — restoring into a
# database that does not exist yet — is safe at any time and is how a backup
# should be tested. --replace-live drops the target first: stop the api and
# worker before doing that (docs/DEPLOYMENT.md, "Backups").
#
# COMPOSE overrides the compose invocation, e.g. for a local stack:
#   COMPOSE="docker compose" scripts/backup/restore.sh ...
set -eu

usage() {
  echo "usage: $0 <file.dump> <target-db> [--replace-live]" >&2
  exit 2
}

[ $# -ge 2 ] || usage
DUMP="$1"
TARGET="$2"
MODE="${3:-}"
COMPOSE="${COMPOSE:-docker compose --env-file .env.staging -f docker-compose.staging.yml}"

[ -f "$DUMP" ] || { echo "no such file: $DUMP" >&2; exit 1; }
case "$TARGET" in
  '' | *[!A-Za-z0-9_]*)
    echo "target database name must match [A-Za-z0-9_]+" >&2
    exit 2
    ;;
esac

# Runs a script inside the postgres container (where POSTGRES_USER is the
# admin role) with TARGET as its $1.
in_pg() {
  script="$1"
  shift
  $COMPOSE exec -T postgres sh -c "$script" sh "$@"
}

# Safe to quote inline: TARGET was restricted to [A-Za-z0-9_] above.
exists=$(in_pg "psql -U \"\$POSTGRES_USER\" -d postgres -tAc \"SELECT 1 FROM pg_database WHERE datname = '\$1'\"" "$TARGET" </dev/null)

if [ "$exists" = "1" ]; then
  if [ "$MODE" != "--replace-live" ]; then
    echo "database $TARGET exists; pass --replace-live to drop and replace it" >&2
    exit 1
  fi
  echo "Dropping $TARGET (open connections are terminated) ..."
  in_pg 'dropdb -U "$POSTGRES_USER" --force "$1"' "$TARGET" </dev/null
fi

echo "Creating $TARGET ..."
in_pg 'createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$1"' "$TARGET" </dev/null

# Owners and grants are restored as dumped, so the app role (DB_USERNAME)
# must exist. It does on the same cluster; on a rebuilt one, first run
#   in the container: psql -U "$POSTGRES_USER" -d postgres -f globals_<ts>.sql
echo "Restoring $DUMP into $TARGET ..."
in_pg 'pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error --single-transaction' "$TARGET" <"$DUMP"

echo "Restored. Applied migrations in $TARGET:"
in_pg 'psql -U "$POSTGRES_USER" -d "$1" -tAc "SELECT count(*) FROM migrations"' "$TARGET" </dev/null
