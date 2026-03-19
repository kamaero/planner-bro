#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_VENV_DIR="$ROOT_DIR/.venv-check312"
BACKEND_PYTHON_BIN=""

pass() {
  echo "[PASS] $1"
}

info() {
  echo "[INFO] $1"
}

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command is missing: $cmd"
}

check_backend_deps() {
  "$BACKEND_PYTHON_BIN" - <<'PY'
try:
    import fastapi  # noqa: F401
    import sqlalchemy  # noqa: F401
    import asyncpg  # noqa: F401
except Exception as exc:
    raise SystemExit(str(exc))
PY
}

run_frontend_checks() {
  info "Running frontend typecheck"
  (cd "$FRONTEND_DIR" && npm run typecheck)
  pass "frontend typecheck"

  info "Running frontend lint"
  (cd "$FRONTEND_DIR" && npm run lint)
  pass "frontend lint"
}

run_backend_checks() {
  if [[ -x "$BACKEND_VENV_DIR/bin/python" ]]; then
    BACKEND_PYTHON_BIN="$BACKEND_VENV_DIR/bin/python"
    info "Using backend virtualenv: $BACKEND_VENV_DIR"
  else
    BACKEND_PYTHON_BIN="$(command -v python3)"
    info "Using system Python for backend checks: $BACKEND_PYTHON_BIN"
  fi

  info "Checking backend Python dependencies"
  if ! (cd "$BACKEND_DIR" && check_backend_deps >/dev/null 2>&1); then
    fail "Backend check dependencies are not installed for $BACKEND_PYTHON_BIN. Recommended setup: ./scripts/setup-backend-check-env.sh"
  fi
  pass "backend dependencies available"

  info "Running backend unittest smoke suite"
  (
    cd "$BACKEND_DIR" && \
    DEBUG=true \
    SECRET_KEY=local-check-secret \
    "$BACKEND_PYTHON_BIN" -m unittest discover -s tests -p '*_smoke.py' -q
  )
  pass "backend unittest smoke suite"
}

main() {
  require_cmd npm
  require_cmd python3

  info "PlannerBro local verification started"
  run_frontend_checks
  run_backend_checks
  pass "all local checks"
}

main "$@"
