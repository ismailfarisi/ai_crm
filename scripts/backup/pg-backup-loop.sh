#!/bin/sh
# Nightly logical backup of the CRM database, run by the `backup` service in
# docker-compose.staging.yml (postgres image, so pg_dump matches the server).
#
# Every day at BACKUP_HOUR_UTC it writes, into /backups:
#   <db>_<UTC timestamp>.dump      pg_dump custom format (pg_restore-able)
#   globals_<UTC timestamp>.sql    roles and grants (pg_dumpall --globals-only)
# A dump is written to a .partial file, checked with `pg_restore --list`, and
# only then renamed, so a half-written file never looks like a backup.
# After a successful run, files older than BACKUP_RETENTION_DAYS are pruned —
# never after a failed one, so a broken backup cannot eat the good ones.
#
# Connection comes from the standard libpq variables (PGHOST, PGUSER,
# PGPASSWORD, PGDATABASE) set by compose from the existing DB_ADMIN_* values.
set -eu

: "${PGDATABASE:?PGDATABASE must be set}"
DIR="${BACKUP_PATH:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
HOUR_UTC="${BACKUP_HOUR_UTC:-2}"

umask 077
mkdir -p "$DIR"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"; }

run_backup() {
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  out="$DIR/${PGDATABASE}_${ts}.dump"
  tmp="$out.partial"
  globals="$DIR/globals_${ts}.sql"

  log "dumping $PGDATABASE to $out"
  if ! pg_dump --format=custom --compress=6 --file="$tmp" "$PGDATABASE"; then
    rm -f "$tmp"
    log "FAILED: pg_dump exited non-zero; keeping existing backups"
    return 1
  fi
  if ! pg_restore --list "$tmp" >/dev/null; then
    rm -f "$tmp"
    log "FAILED: dump is not readable by pg_restore; keeping existing backups"
    return 1
  fi
  mv "$tmp" "$out"

  if pg_dumpall --globals-only --file="$globals.partial"; then
    mv "$globals.partial" "$globals"
  else
    rm -f "$globals.partial"
    log "WARNING: globals dump failed (the database dump is fine)"
  fi

  log "ok: $(du -h "$out" | cut -f1); pruning files older than ${RETENTION_DAYS}d"
  find "$DIR" -maxdepth 1 -type f \
    \( -name "${PGDATABASE}_*.dump" -o -name 'globals_*.sql' \) \
    -mtime +"$RETENTION_DAYS" -print -delete
}

seconds_until_next_run() {
  now=$(date -u +%s)
  since_midnight=$((now % 86400))
  target=$((HOUR_UTC * 3600))
  wait=$(((target - since_midnight + 86400) % 86400))
  [ "$wait" -eq 0 ] && wait=86400
  echo "$wait"
}

# Catch up on start if there is no dump from the last day (first boot, or the
# host was down over the scheduled hour).
if [ -z "$(find "$DIR" -maxdepth 1 -name "${PGDATABASE}_*.dump" -mmin -1440 2>/dev/null)" ]; then
  run_backup || true
fi

while true; do
  wait=$(seconds_until_next_run)
  log "next run in ${wait}s (daily at ${HOUR_UTC}:00 UTC, keeping ${RETENTION_DAYS}d)"
  sleep "$wait"
  run_backup || true
done
