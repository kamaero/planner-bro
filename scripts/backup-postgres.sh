#!/usr/bin/env bash
# Dump Postgres from the running production container, compress, rotate old backups.
# Usage (from local machine): bash scripts/backup-postgres.sh
# Usage (VPS cron, e.g. daily at 03:00):
#   0 3 * * * bash /opt/planner-bro/scripts/backup-postgres.sh --local >> /var/log/planner-backup.log 2>&1
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@95.164.92.165}"
REMOTE_DIR="${REMOTE_DIR:-/opt/planner-bro}"
COMPOSE_FILE="${COMPOSE_FILE:-$REMOTE_DIR/docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/postgres}"
KEEP="${KEEP:-7}"   # retain this many daily dumps

# When called with --local the script runs in-place on the VPS (for cron)
if [[ "${1:-}" == "--local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$REMOTE_DIR/.env.prod"
  set +a
  DATE=$(date +%Y%m%d_%H%M%S)
  mkdir -p "$BACKUP_DIR"
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "${POSTGRES_USER:-planner}" "${POSTGRES_DB:-plannerdb}" \
    | gzip > "$BACKUP_DIR/plannerdb_${DATE}.sql.gz"
  echo "[$(date -Iseconds)] Backup saved: $BACKUP_DIR/plannerdb_${DATE}.sql.gz"
  # Rotate: keep only KEEP most recent files
  ls -t "$BACKUP_DIR"/plannerdb_*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
  echo "[$(date -Iseconds)] Rotation done, keeping $KEEP latest backups."
  exit 0
fi

# Remote invocation from local machine
echo "[1/2] Running backup on $REMOTE_HOST..."
ssh "$REMOTE_HOST" \
  "REMOTE_DIR='$REMOTE_DIR' COMPOSE_FILE='$COMPOSE_FILE' BACKUP_DIR='$BACKUP_DIR' KEEP='$KEEP' \
   bash '$REMOTE_DIR/scripts/backup-postgres.sh' --local"
echo "[2/2] Done."
