#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@168.222.194.92}"
EMAIL="${1:-}"

if [ -z "$EMAIL" ]; then
  echo "Usage: $0 <email>"
  exit 1
fi

ssh "$REMOTE_HOST" "EMAIL='$EMAIL' bash -s" <<'EOF'
set -euo pipefail

TEMP_PASSWORD=$(python3 - <<'PY'
import secrets, string
alphabet = string.ascii_letters + string.digits
print(''.join(secrets.choice(alphabet) for _ in range(16)))
PY
)

HASH=$(docker exec planner-bro-backend-1 python -c "from passlib.context import CryptContext as C; print(C(schemes=['bcrypt'], deprecated='auto').hash('${TEMP_PASSWORD}'))")

docker exec planner-bro-postgres-1 psql -v ON_ERROR_STOP=1 -U planner -d plannerdb -c 'update users set password_hash = $$'"$HASH"'$$ where lower(email)=lower('"'"'${EMAIL}'"'"');'

echo "$TEMP_PASSWORD"
EOF
