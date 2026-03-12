#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@168.222.194.92}"
REMOTE_DIR="${REMOTE_DIR:-/opt/planner-bro}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PRUNE_IMAGES="${PRUNE_IMAGES:-0}"
SYNC_CODE="${SYNC_CODE:-1}"
RESTART_SERVICES="${RESTART_SERVICES:-1}"
RUN_SMOKE_TESTS="${RUN_SMOKE_TESTS:-1}"
FAIL_ON_SMOKE_FAIL="${FAIL_ON_SMOKE_FAIL:-1}"

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

ssh "$REMOTE_HOST" "REMOTE_DIR='$REMOTE_DIR' COMPOSE_FILE='$COMPOSE_FILE' PRUNE_IMAGES='$PRUNE_IMAGES' RESTART_SERVICES='$RESTART_SERVICES' RUN_SMOKE_TESTS='$RUN_SMOKE_TESTS' FAIL_ON_SMOKE_FAIL='$FAIL_ON_SMOKE_FAIL' bash -s" <<'EOF'
set -euo pipefail

cd "$REMOTE_DIR"

if [ "$RESTART_SERVICES" = "1" ]; then
  if docker compose version >/dev/null 2>&1; then
    docker compose --env-file .env.prod -f "$COMPOSE_FILE" up -d --build backend celery_worker celery_beat nginx
  else
    docker-compose --env-file .env.prod -f "$COMPOSE_FILE" up -d --build backend celery_worker celery_beat nginx
  fi
fi

if [ "$PRUNE_IMAGES" = "1" ]; then
  docker image prune -f
fi

if [ "$RUN_SMOKE_TESTS" = "1" ]; then
  echo "Running backend smoke tests..."
  TEST_OUTPUT_FILE="$(mktemp)"
  SMOKE_CMD="python -m unittest discover -s tests -p 'test_*_smoke.py' -v"
  set +e
  docker compose --env-file .env.prod -f "$COMPOSE_FILE" exec -T backend sh -lc "$SMOKE_CMD" >"$TEST_OUTPUT_FILE" 2>&1
  SMOKE_EXIT_CODE=$?
  set -e

  TEST_OUTPUT="$(cat "$TEST_OUTPUT_FILE")"
  TEST_TAIL="$(tail -n 60 "$TEST_OUTPUT_FILE")"
  TEST_SUMMARY="$(grep -E '^(Ran [0-9]+ tests|FAILED|OK)' "$TEST_OUTPUT_FILE" | tail -n 3 || true)"
  rm -f "$TEST_OUTPUT_FILE"

  if [ "$SMOKE_EXIT_CODE" -eq 0 ]; then
    SMOKE_LEVEL="info"
    SMOKE_MESSAGE="Backend smoke tests: PASS"
  else
    SMOKE_LEVEL="error"
    SMOKE_MESSAGE="Backend smoke tests: FAIL"
  fi

  TEST_TAIL_B64="$(printf '%s' "$TEST_TAIL" | base64 | tr -d '\n')"
  TEST_SUMMARY_B64="$(printf '%s' "$TEST_SUMMARY" | base64 | tr -d '\n')"

  docker compose --env-file .env.prod -f "$COMPOSE_FILE" exec -T \
    -e SMOKE_LEVEL="$SMOKE_LEVEL" \
    -e SMOKE_MESSAGE="$SMOKE_MESSAGE" \
    -e SMOKE_EXIT_CODE="$SMOKE_EXIT_CODE" \
    -e SMOKE_COMMAND="$SMOKE_CMD" \
    -e SMOKE_TEST_OUTPUT_TAIL_B64="$TEST_TAIL_B64" \
    -e SMOKE_TEST_SUMMARY_B64="$TEST_SUMMARY_B64" \
    backend python - <<'PY'
import asyncio
import base64
import os

from app.services.system_activity_service import log_system_activity_standalone


def _decode_b64(name: str) -> str:
    value = os.getenv(name, "")
    if not value:
        return ""
    try:
        return base64.b64decode(value.encode("ascii")).decode("utf-8", errors="replace")
    except Exception:
        return ""


async def _main() -> None:
    await log_system_activity_standalone(
        source="deploy-script",
        category="deploy_checks",
        level=os.getenv("SMOKE_LEVEL", "info"),
        message=os.getenv("SMOKE_MESSAGE", "Backend smoke tests"),
        details={
            "command": os.getenv("SMOKE_COMMAND", ""),
            "exit_code": int(os.getenv("SMOKE_EXIT_CODE", "1")),
            "summary": _decode_b64("SMOKE_TEST_SUMMARY_B64"),
            "tail": _decode_b64("SMOKE_TEST_OUTPUT_TAIL_B64"),
        },
    )


asyncio.run(_main())
PY

  if [ "$SMOKE_EXIT_CODE" -ne 0 ]; then
    echo "$TEST_OUTPUT"
    if [ "$FAIL_ON_SMOKE_FAIL" = "1" ]; then
      echo "Smoke tests failed; aborting deploy."
      exit 1
    fi
  fi
fi
EOF

echo "Backend deployed to $REMOTE_HOST:$REMOTE_DIR"
