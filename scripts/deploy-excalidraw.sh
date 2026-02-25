#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@95.164.92.165}"
REMOTE_DIR="${REMOTE_DIR:-/opt/planner-bro}"
EXCALIDRAW_DIR="${EXCALIDRAW_DIR:-$REMOTE_DIR/excalidraw}"
EXCALIDRAW_REPO="${EXCALIDRAW_REPO:-https://github.com/excalidraw/excalidraw.git}"
EXCALIDRAW_BRANCH="${EXCALIDRAW_BRANCH:-master}"
IMAGE_NAME="${IMAGE_NAME:-planner-bro-excalidraw:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-planner-bro-excalidraw-1}"
NETWORK_NAME="${NETWORK_NAME:-planner-bro_default}"
SSH_OPTS="${SSH_OPTS:- -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=8}"

ssh $SSH_OPTS "$REMOTE_HOST" "REMOTE_DIR='$REMOTE_DIR' EXCALIDRAW_DIR='$EXCALIDRAW_DIR' EXCALIDRAW_REPO='$EXCALIDRAW_REPO' EXCALIDRAW_BRANCH='$EXCALIDRAW_BRANCH' IMAGE_NAME='$IMAGE_NAME' CONTAINER_NAME='$CONTAINER_NAME' NETWORK_NAME='$NETWORK_NAME' bash -s" <<'EOF'
set -euo pipefail

if [ ! -d "$EXCALIDRAW_DIR/.git" ]; then
  git clone --depth 1 --branch "$EXCALIDRAW_BRANCH" "$EXCALIDRAW_REPO" "$EXCALIDRAW_DIR"
else
  git -C "$EXCALIDRAW_DIR" fetch --depth 1 origin "$EXCALIDRAW_BRANCH"
  git -C "$EXCALIDRAW_DIR" checkout "$EXCALIDRAW_BRANCH"
  git -C "$EXCALIDRAW_DIR" reset --hard "origin/$EXCALIDRAW_BRANCH"
fi

python3 - <<'PY'
from pathlib import Path

cfg = Path("/opt/planner-bro/excalidraw/excalidraw-app/vite.config.mts")
text = cfg.read_text(encoding="utf-8")
if 'base: "/excalidraw/"' not in text:
    marker = "return {\n"
    idx = text.find(marker)
    if idx == -1:
        raise SystemExit("Could not patch vite config: return block not found")
    insert_at = idx + len(marker)
    text = text[:insert_at] + '    base: "/excalidraw/",\n' + text[insert_at:]
    cfg.write_text(text, encoding="utf-8")
PY

python3 - <<'PY'
from pathlib import Path

dockerfile = Path("/opt/planner-bro/excalidraw/Dockerfile")
text = dockerfile.read_text(encoding="utf-8")
text = text.replace("FROM --platform=${BUILDPLATFORM} node:18 AS build", "FROM --platform=${BUILDPLATFORM} node:20 AS build")
dockerfile.write_text(text, encoding="utf-8")
PY

docker build -t "$IMAGE_NAME" "$EXCALIDRAW_DIR"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME"
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart always \
  --network "$NETWORK_NAME" \
  "$IMAGE_NAME"

cd "$REMOTE_DIR"
docker compose -f docker-compose.prod.yml up -d nginx
EOF

echo "Excalidraw deployed to $REMOTE_HOST"
