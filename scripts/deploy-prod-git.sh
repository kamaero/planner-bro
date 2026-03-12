#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@168.222.194.92}"
LIVE_DIR="${LIVE_DIR:-/opt/planner-bro}"
REPO_DIR="${REPO_DIR:-/opt/planner-bro-git}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
GIT_REMOTE="${GIT_REMOTE:-git@github.com:kamaero/planner-bro.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"
RUN_FRONTEND_BUILD="${RUN_FRONTEND_BUILD:-1}"
RUN_SMOKE_TESTS="${RUN_SMOKE_TESTS:-1}"
FAIL_ON_SMOKE_FAIL="${FAIL_ON_SMOKE_FAIL:-1}"
PRUNE_IMAGES="${PRUNE_IMAGES:-0}"

ssh "$REMOTE_HOST" \
  "LIVE_DIR='$LIVE_DIR' REPO_DIR='$REPO_DIR' COMPOSE_FILE='$COMPOSE_FILE' GIT_REMOTE='$GIT_REMOTE' GIT_BRANCH='$GIT_BRANCH' RUN_FRONTEND_BUILD='$RUN_FRONTEND_BUILD' RUN_SMOKE_TESTS='$RUN_SMOKE_TESTS' FAIL_ON_SMOKE_FAIL='$FAIL_ON_SMOKE_FAIL' PRUNE_IMAGES='$PRUNE_IMAGES' bash -s" <<'EOF'
set -euo pipefail

echo "[1/6] Preparing repository checkout"
mkdir -p "$(dirname "$LIVE_DIR")" "$(dirname "$REPO_DIR")"

if [ ! -d "$REPO_DIR/.git" ]; then
  git clone --branch "$GIT_BRANCH" "$GIT_REMOTE" "$REPO_DIR"
else
  git -C "$REPO_DIR" remote set-url origin "$GIT_REMOTE"
  git -C "$REPO_DIR" fetch --prune origin
  git -C "$REPO_DIR" checkout -B "$GIT_BRANCH" "origin/$GIT_BRANCH"
fi

git -C "$REPO_DIR" fetch --prune origin
git -C "$REPO_DIR" reset --hard "origin/$GIT_BRANCH"

echo "[2/6] Syncing git checkout into live directory"
mkdir -p "$LIVE_DIR"
mkdir -p "$LIVE_DIR/uploads" "$LIVE_DIR/nginx/ssl"

rsync -az --delete \
  --exclude '.git/' \
  --exclude '.env.prod' \
  --exclude 'uploads/' \
  --exclude 'nginx/ssl/' \
  --exclude 'frontend/dist/' \
  --exclude 'frontend/node_modules/' \
  "$REPO_DIR/" "$LIVE_DIR/"

echo "[3/6] Building frontend dist on server"
if [ "$RUN_FRONTEND_BUILD" = "1" ]; then
  cd "$LIVE_DIR/frontend"
  npm ci
  npm run build:prod
fi

echo "[4/6] Restarting production services"
cd "$LIVE_DIR"
if docker compose version >/dev/null 2>&1; then
  docker compose --env-file .env.prod -f "$COMPOSE_FILE" up -d --build backend celery_worker celery_beat nginx frontend
else
  docker-compose --env-file .env.prod -f "$COMPOSE_FILE" up -d --build backend celery_worker celery_beat nginx frontend
fi

if [ "$PRUNE_IMAGES" = "1" ]; then
  echo "[5/6] Pruning unused Docker images"
  docker image prune -f
else
  echo "[5/6] Skipping Docker image prune"
fi

if [ "$RUN_SMOKE_TESTS" = "1" ]; then
  echo "[6/6] Running smoke-check"
  chmod +x "$LIVE_DIR/scripts/smoke-check-prod.sh"
  set +e
  "$LIVE_DIR/scripts/smoke-check-prod.sh"
  SMOKE_EXIT_CODE=$?
  set -e
  if [ "$SMOKE_EXIT_CODE" -ne 0 ]; then
    if [ "$FAIL_ON_SMOKE_FAIL" = "1" ]; then
      echo "Smoke-check failed; deploy is marked as failed."
      exit 1
    fi
    echo "Smoke-check failed, but FAIL_ON_SMOKE_FAIL=0 so we continue."
  fi
else
  echo "[6/6] Smoke-check skipped"
fi
EOF

echo "Git-based production deploy finished for $REMOTE_HOST"
