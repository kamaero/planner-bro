#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@95.164.92.165}"
REMOTE_DIR="${REMOTE_DIR:-/opt/planner-bro}"
NETWORK_NAME="${NETWORK_NAME:-planner-bro_default}"
SSH_OPTS="${SSH_OPTS:- -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=8}"

ssh $SSH_OPTS "$REMOTE_HOST" "REMOTE_DIR='$REMOTE_DIR' NETWORK_NAME='$NETWORK_NAME' bash -s" <<'EOF'
set -euo pipefail

cd "$REMOTE_DIR"

if [ ! -f ".env.prod" ]; then
  echo "Missing $REMOTE_DIR/.env.prod"
  exit 1
fi

REDIS_PASSWORD="$(grep -E '^REDIS_PASSWORD=' .env.prod | head -n1 | cut -d= -f2-)"
if [ -z "${REDIS_PASSWORD:-}" ]; then
  echo "Missing REDIS_PASSWORD in .env.prod"
  exit 1
fi

docker pull alswl/excalidraw:v0.18.0-fork-b3
docker pull alswl/excalidraw-storage-backend:v2023.11.11
docker pull excalidraw/excalidraw-room:sha-49bf529

docker rm -f planner-bro-excalidraw-1 >/dev/null 2>&1 || true
docker rm -f planner-bro-excalidraw-app-1 >/dev/null 2>&1 || true
docker rm -f planner-bro-excalidraw-storage-1 >/dev/null 2>&1 || true
docker rm -f planner-bro-excalidraw-room-1 >/dev/null 2>&1 || true

docker run -d \
  --name planner-bro-excalidraw-storage-1 \
  --restart always \
  --network "$NETWORK_NAME" \
  -e PORT=8080 \
  -e STORAGE_URI="redis://:${REDIS_PASSWORD}@planner-bro-redis-1:6379/6" \
  alswl/excalidraw-storage-backend:v2023.11.11

docker run -d \
  --name planner-bro-excalidraw-room-1 \
  --restart always \
  --network "$NETWORK_NAME" \
  excalidraw/excalidraw-room:sha-49bf529

docker run -d \
  --name planner-bro-excalidraw-app-1 \
  --restart always \
  --network "$NETWORK_NAME" \
  -e VITE_APP_BACKEND_V2_GET_URL="https://plannerbro.ru/excalidraw-storage/api/v2/scenes/" \
  -e VITE_APP_BACKEND_V2_POST_URL="https://plannerbro.ru/excalidraw-storage/api/v2/scenes/" \
  -e VITE_APP_WS_SERVER_URL="https://plannerbro.ru" \
  -e VITE_APP_FIREBASE_CONFIG="{}" \
  -e VITE_APP_HTTP_STORAGE_BACKEND_URL="https://plannerbro.ru/excalidraw-storage/api/v2" \
  -e VITE_APP_STORAGE_BACKEND="http" \
  -e VITE_APP_DISABLE_TRACKING="true" \
  alswl/excalidraw:v0.18.0-fork-b3

docker compose -f docker-compose.prod.yml up -d --force-recreate nginx
EOF

echo "Excalidraw internal stack deployed to $REMOTE_HOST"
