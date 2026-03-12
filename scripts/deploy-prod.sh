#!/usr/bin/env bash
set -euo pipefail

SKIP_FRONTEND="${SKIP_FRONTEND:-0}"
DEPLOY_MODE="${DEPLOY_MODE:-rsync}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$DEPLOY_MODE" in
  rsync)
    "$SCRIPT_DIR"/deploy-prod-backend.sh
    if [ "$SKIP_FRONTEND" != "1" ]; then
      "$SCRIPT_DIR"/deploy-frontend-dist.sh
    fi
    ;;
  git)
    "$SCRIPT_DIR"/deploy-prod-git.sh
    ;;
  *)
    echo "Unknown DEPLOY_MODE: $DEPLOY_MODE"
    echo "Supported values: rsync, git"
    exit 1
    ;;
esac

echo "Production deploy finished (mode: $DEPLOY_MODE)"
