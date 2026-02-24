#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@95.164.92.165}"
REMOTE_DIR="${REMOTE_DIR:-/opt/planner-bro}"
REMOTE_BRANCH="${REMOTE_BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PRUNE_IMAGES="${PRUNE_IMAGES:-0}"

ssh "$REMOTE_HOST" bash -lc "
  set -euo pipefail
  cd '$REMOTE_DIR'

  if [ -d .git ]; then
    git fetch origin
    git checkout '$REMOTE_BRANCH'
    git pull --ff-only origin '$REMOTE_BRANCH'
  fi

  if docker compose version >/dev/null 2>&1; then
    DC='docker compose'
  else
    DC='docker-compose'
  fi

  \$DC -f '$COMPOSE_FILE' up -d --build backend celery_worker celery_beat nginx

  if [ "$PRUNE_IMAGES" = "1" ]; then
    docker image prune -f
  fi
"

echo "Backend deployed to $REMOTE_HOST:$REMOTE_DIR"
