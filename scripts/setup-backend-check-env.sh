#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv-check312"

if ! command -v python3.12 >/dev/null 2>&1; then
  echo "[FAIL] python3.12 is required to prepare backend check environment." >&2
  exit 1
fi

echo "[INFO] Creating backend check virtualenv at $VENV_DIR"
python3.12 -m venv "$VENV_DIR"

echo "[INFO] Installing backend requirements"
"$VENV_DIR/bin/pip" install -r "$ROOT_DIR/backend/requirements.txt"

echo "[PASS] Backend check environment is ready"
echo "[INFO] You can now run: ./scripts/check-local.sh"
