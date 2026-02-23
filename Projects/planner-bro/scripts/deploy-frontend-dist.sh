#!/usr/bin/env bash
set -euo pipefail

# Deploy frontend without server-side Docker build:
# 1) build dist locally
# 2) sync dist to VPS
# 3) restart frontend nginx container

REMOTE_HOST="${REMOTE_HOST:-root@95.164.92.165}"
REMOTE_DIR="${REMOTE_DIR:-/opt/planner-bro}"
LOCAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[1/4] Build frontend dist locally"
cd "$LOCAL_ROOT/frontend"
npm run build:prod

echo "[2/4] Sync dist and nginx SPA config to VPS"
rsync -az --delete "$LOCAL_ROOT/frontend/dist/" "$REMOTE_HOST:$REMOTE_DIR/frontend/dist/"
rsync -az "$LOCAL_ROOT/frontend/nginx-spa.conf" "$REMOTE_HOST:$REMOTE_DIR/frontend/nginx-spa.conf"

echo "[3/4] Ensure frontend container is up (no build)"
ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && docker compose -f docker-compose.prod.yml up -d frontend"

echo "[4/4] Done. Frontend deployed from prebuilt dist."
