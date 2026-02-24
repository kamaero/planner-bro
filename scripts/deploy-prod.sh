#!/usr/bin/env bash
set -euo pipefail

SKIP_FRONTEND="${SKIP_FRONTEND:-0}"

"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"/deploy-prod-backend.sh

if [ "$SKIP_FRONTEND" != "1" ]; then
  "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"/deploy-frontend-dist.sh
fi

echo "Production deploy finished"
