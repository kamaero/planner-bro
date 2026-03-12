#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://plannerbro.ru}"
LOGIN_EMAIL="${LOGIN_EMAIL:-${SMOKE_EMAIL:-}}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-${SMOKE_PASSWORD:-}}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "[PASS] $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "[FAIL] $1" >&2
}

check_status() {
  local label="$1"
  local url="$2"
  local expected="${3:-200}"
  local status

  status="$(curl -ksS -o /dev/null -w '%{http_code}' "$url" || true)"
  if [[ "$status" == "$expected" ]]; then
    pass "$label ($status)"
  else
    fail "$label (expected $expected, got ${status:-curl-error})"
  fi
}

check_contains() {
  local label="$1"
  local file="$2"
  local needle="$3"

  if grep -Fq "$needle" "$file"; then
    pass "$label"
  else
    fail "$label"
  fi
}

echo "Smoke-check for $BASE_URL"

check_status "Homepage responds" "$BASE_URL/"
check_status "Team board responds" "$BASE_URL/team-board"
check_status "Health endpoint responds" "$BASE_URL/health"

curl -ksS "$BASE_URL/health" > "$TMP_DIR/health.json"
python3 - "$TMP_DIR/health.json" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
status = payload.get("status")
db = payload.get("db")
redis = payload.get("redis")
if status != "ok" or db != "ok" or redis != "ok":
    raise SystemExit(
        f"health is not ok: status={status!r}, db={db!r}, redis={redis!r}"
    )
PY
pass "Health payload says db/redis are healthy"

curl -ksS "$BASE_URL/" > "$TMP_DIR/index.html"
check_contains "Frontend shell contains root node" "$TMP_DIR/index.html" 'id="root"'

ASSET_PATH="$(
  python3 - "$TMP_DIR/index.html" <<'PY'
import re
import sys
from pathlib import Path

html = Path(sys.argv[1]).read_text(encoding="utf-8")
match = re.search(r'/assets/index-[^"]+\.js', html)
if not match:
    raise SystemExit("Could not find main frontend bundle in HTML")
print(match.group(0))
PY
)"

curl -ksS "$BASE_URL$ASSET_PATH" > "$TMP_DIR/app.js"
check_contains "Bundle still contains team whiteboard route" "$TMP_DIR/app.js" 'plannerbro_team_whiteboard'
check_contains "Bundle keeps iframe referrer fix" "$TMP_DIR/app.js" 'referrerPolicy:"no-referrer"'

if [[ -n "$LOGIN_EMAIL" && -n "$LOGIN_PASSWORD" ]]; then
  python3 - "$BASE_URL" "$LOGIN_EMAIL" "$LOGIN_PASSWORD" > "$TMP_DIR/login.json" <<'PY'
import json
import sys
import urllib.request

base_url, email, password = sys.argv[1:4]
request = urllib.request.Request(
    f"{base_url}/api/v1/auth/login",
    data=json.dumps({"email": email, "password": password}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=20) as response:
    print(response.read().decode("utf-8"))
PY

  ACCESS_TOKEN="$(
    python3 - "$TMP_DIR/login.json" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
token = payload.get("access_token", "")
if not token:
    raise SystemExit("Login response does not contain access_token")
print(token)
PY
  )"
  pass "Login returns access token"

  curl -ksS \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "$BASE_URL/api/v1/users/me" > "$TMP_DIR/me.json"
  python3 - "$TMP_DIR/me.json" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if not payload.get("email"):
    raise SystemExit("Authenticated profile does not contain email")
PY
  pass "Authenticated /users/me responds"
else
  echo "[INFO] Login check skipped. Set LOGIN_EMAIL and LOGIN_PASSWORD if you want a full auth smoke-check."
fi

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "Smoke-check finished with $FAIL_COUNT failure(s) and $PASS_COUNT pass(es)." >&2
  exit 1
fi

echo "Smoke-check passed with $PASS_COUNT checks."
