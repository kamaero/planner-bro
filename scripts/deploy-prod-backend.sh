#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@95.164.92.165}"
REMOTE_DIR="${REMOTE_DIR:-/opt/planner-bro}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PRUNE_IMAGES="${PRUNE_IMAGES:-0}"
SYNC_CODE="${SYNC_CODE:-1}"
RESTART_SERVICES="${RESTART_SERVICES:-1}"

LOCAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$SYNC_CODE" = "1" ]; then
  rsync -az --delete --no-owner --no-group \
    "$LOCAL_ROOT/backend/" \
    "$REMOTE_HOST:$REMOTE_DIR/backend/"

  rsync -az --no-owner --no-group \
    "$LOCAL_ROOT/docker-compose.prod.yml" \
    "$REMOTE_HOST:$REMOTE_DIR/docker-compose.prod.yml"

  rsync -az --delete --no-owner --no-group \
    --exclude 'ssl/' \
    "$LOCAL_ROOT/nginx/" \
    "$REMOTE_HOST:$REMOTE_DIR/nginx/"

  rsync -az --delete --no-owner --no-group \
    "$LOCAL_ROOT/scripts/" \
    "$REMOTE_HOST:$REMOTE_DIR/scripts/"

  rsync -az --no-owner --no-group \
    "$LOCAL_ROOT/README.md" \
    "$REMOTE_HOST:$REMOTE_DIR/README.md"
fi

ssh "$REMOTE_HOST" "REMOTE_DIR='$REMOTE_DIR' COMPOSE_FILE='$COMPOSE_FILE' PRUNE_IMAGES='$PRUNE_IMAGES' RESTART_SERVICES='$RESTART_SERVICES' bash -s" <<'EOF'
set -euo pipefail

cd "$REMOTE_DIR"

if [ "$RESTART_SERVICES" = "1" ]; then
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" up -d --build backend celery_worker celery_beat nginx
  else
    docker-compose -f "$COMPOSE_FILE" up -d --build backend celery_worker celery_beat nginx
  fi
fi

if [ "$PRUNE_IMAGES" = "1" ]; then
  docker image prune -f
fi
EOF

echo "Backend deployed to $REMOTE_HOST:$REMOTE_DIR"
