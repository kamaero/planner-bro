# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Start everything (Docker)
```bash
cp .env.example .env   # first time only — fill in SECRET_KEY at minimum
docker-compose up --build
# Web UI: http://localhost:80 | API docs: http://localhost:8000/docs
```

### Backend (local, no Docker)
```bash
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload          # API on :8000

# Run a specific Celery worker or beat scheduler:
celery -A app.tasks.celery_app worker --loglevel=info
celery -A app.tasks.celery_app beat   --loglevel=info

# Create a new Alembic migration after model changes:
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

### Frontend (local)
```bash
cd frontend
npm install
npm run dev        # Vite dev server on :5173 (proxies /api and /ws to :8000)
npm run build      # production build → dist/
npm run lint
```

### Flutter mobile
```bash
cd mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8000/api/v1
# 10.0.2.2 is the Android emulator's host loopback address
```

### Production deploy (rsync from local, recommended)
```bash
# Full deploy (backend + frontend):
./scripts/deploy-prod.sh

# Backend only (faster, skip frontend rebuild):
SKIP_FRONTEND=1 ./scripts/deploy-prod.sh

# Individual helper scripts:
./scripts/deploy-prod-backend.sh   # rsync backend + restart containers
./scripts/deploy-frontend-dist.sh  # build locally, rsync dist/ to VPS nginx
```

### Production deploy (manual, on VPS directly)
```bash
# First-time setup — clone the repo (requires deploy key, see below):
cd /opt
git clone git@github-planner:kamaero/planner-bro.git planner-bro-git

# Subsequent deploys — SSH in and pull:
ssh root@168.222.194.92
cd /opt/planner-bro
git pull
docker compose -f docker-compose.prod.yml up -d --build backend celery_worker celery_beat nginx
```

**Deploy key for VPS** (read-only access to the private repo):
Add this public key to https://github.com/kamaero/planner-bro/settings/keys
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILLfE3OprmuN3OLalz6w3QTUfdtMmkxISQe6Rbcg6lPe planner-bro-vps-deploy
```
The VPS SSH config (`/root/.ssh/config`) already has the `github-planner` alias pointing to this key.

## Architecture

### Request flow
```
Client (browser / Flutter)
  → Nginx (:80/:443)
    → /api/*   → FastAPI backend (:8000)
    → /ws      → FastAPI WebSocket (:8000)
    → /        → React SPA (served by nginx-spa.conf)
```

### Backend (`backend/app/`)
Layered FastAPI with async SQLAlchemy:

- **`core/`** — cross-cutting: `config.py` (Pydantic Settings from `.env`), `database.py` (async engine + `get_db` dependency), `security.py` (`get_current_user` Bearer dependency, JWT helpers), `firebase.py` (FCM admin SDK, gracefully no-ops if credentials file absent)
- **`models/`** — SQLAlchemy ORM. All PKs are `str` UUIDs. `ProjectMember` is a composite-PK join table (project_id + user_id). `Task.parent_task_id` is a self-referential FK for subtasks. `ProjectFile` stores uploaded files per project. `DeadlineChange` records every end_date mutation with old/new dates and a mandatory reason. `VaultFile` stores encrypted team file metadata. `Department` supports hierarchical org structure; `User` has `manager_id` (self-ref FK), `department_id`, `position_title`, `work_email` fields.
- **`schemas/`** — Pydantic request/response models, one file per domain. `GanttTask`/`GanttData` in `project.py` map directly to the `gantt-task-react` Task interface.
- **`api/v1/`** — thin route handlers. Authorization helpers (`_require_project_access`, `_require_project_member`) are local to each router file. `tasks.py` router has **no prefix** — task routes are split across `/projects/{id}/tasks` and `/tasks/{id}`. Project files live under `/projects/{id}/files` with upload/list/download/delete endpoints. `vault.py` handles encrypted team storage. `GET /users/online/presence` returns users with active WebSocket connections (polled by sidebar every 30 s).
- **`services/`** — business logic. `notification_service.py` is the central fan-out point: every mutation calls a `notify_*` function which (1) writes DB records, (2) sends FCM via `firebase.py`, (3) broadcasts a WebSocket event via `ws_manager`. `vault_crypto.py` — AES-256-GCM encryption: `derive_file_key` (HKDF-SHA256, file_id as info), `encrypt_file`/`decrypt_file`, signed 15-min download JWTs.
- **`tasks/`** — Celery. `celery_app.py` defines the Beat schedule. `deadline_checker.py` uses `asyncio.run()` to call async DB code from a sync Celery task. `ai_ingestion.py` deletes the source file from disk immediately after text extraction (security + disk hygiene). `telegram_summary_checker.py` posts scheduled summaries to Telegram, `telegram_commands_checker.py` handles `/start`, `/stop`, `/stats`.

### Deadline change audit trail
Every `end_date` change on a task or project **requires a mandatory reason** (`deadline_change_reason` field in PUT body). Validated at the API level — 422 if missing.

Two parallel records are written on each deadline change:
1. **`deadline_changes`** table — stores `entity_type` (`task`/`project`), `entity_id`, `old_date`, `new_date`, `reason`, `changed_by_id`. Queried via `GET /tasks/{id}/deadline-history` and `GET /projects/{id}/deadline-history`.
2. **`task_events`** — a `date_changed` event with `payload="end:old->new"` and `reason` field. Visible in the TaskDrawer "История" list alongside other events.

Frontend: `DeadlineReasonModal` intercepts saves in TaskDrawer and ProjectDetail edit form. Deadline history is displayed as a collapsible section in both places.

### Secure team vault
Encrypted file storage at `/storage` route. Security model:
- **Per-file keys**: `HKDF-SHA256(master_key, file_id)` → 32-byte AES key. Compromising one file's key doesn't expose others.
- **AES-256-GCM** with 96-bit random nonce; 16-byte auth tag detects tampering on decrypt.
- **Download tokens**: short-lived JWT (15 min, HS256) with `{sub, fid, purpose}` claims. Download endpoint skips Bearer auth so browsers can open files directly.
- `VAULT_ENCRYPTION_KEY` in `.env` (64-char hex). Falls back to `SHA-256(SECRET_KEY)` with a warning log if unset.
- Vault files are stored in `VAULT_FILES_DIR` (default `uploads/vault`), mounted as a persistent volume in production.

### Online presence
`GET /users/online/presence` reads `ws_manager._user_sockets.keys()` (in-memory, no DB) and returns `[{id, name}]` for users with active WebSocket connections.  
Sidebar behavior:
- Full active team list (from `GET /users/`) is shown in the lower panel.
- Green dot = online, red dot = offline.
- Presence is polled every 30s.
- Below team presence, sidebar shows "Активность системы" from `GET /notifications/activity/email` (latest SMTP dispatch events: `sent`/`failed`/`skipped`).

### Authorization model
- JWT access token in `Authorization: Bearer` header. `get_current_user` dependency validates it.
- Project access: a user must exist in `project_members` for that project (or have `role="admin"` to bypass).
- Manager-level mutations (update/delete project, manage members) require `ProjectMember.role` of `owner` or `manager`.

### Frontend (`frontend/src/`)
- **`store/authStore.ts`** — Zustand store. Only `refreshToken` is persisted (localStorage via `persist`). `accessToken` lives in memory only.
- **`api/client.ts`** — Axios instance with two interceptors: (1) attaches access token to every request, (2) on 401, calls `/auth/refresh`, saves new tokens, replays queued requests. All API functions are exported from `api` object here.
- **`hooks/useProjects.ts`** — all TanStack Query hooks for projects/tasks/files. On mutations, invalidates both `tasks` and `gantt` query keys since both derive from the same data.
- **`hooks/useVault.ts`** — TanStack Query hooks for vault: `useVaultFiles`, `useUploadVaultFile`, `useDeleteVaultFile`, `useVaultDownloadToken`.
- **`hooks/useWebSocket.ts`** — opens `ws://host/ws?token=...` on mount, dispatches `queryClient.invalidateQueries` on received events. No explicit reconnect logic.
- **`components/GanttChart/`** — wraps `gantt-task-react`. Converts `GanttTask[]` (from the `/gantt` endpoint) to the library's `Task[]` type via `toGanttTasks()`.
- **`pages/Dashboard.tsx`** — compact `Дэшборд IT` with department tabs (`/projects/dashboard/departments`), manual project-to-department linking, and condensed widgets for one-screen visibility.
- **`pages/ProjectDetail.tsx`** — project editing (name/status/dates/owner) and a Files tab for uploading and managing attachments.
- **`pages/TeamStorage.tsx`** — encrypted vault UI: folder tabs, file list, upload panel (with optional description), download via signed token (`window.open`), delete gated by `can_delete`/`admin`.
- **`pages/Team.tsx`** — team management. Users can edit their own display name inline in their card (calls `PUT /users/me`). Admins/managers manage roles, org structure, departments.
- **`App.tsx`** sidebar — lower section includes current user card, full team presence list (online/offline dots), and system email activity monitor.

### Flutter mobile (`mobile/lib/`)
- **`core/api_client.dart`** — singleton `apiClient` (Dio). Token stored in `flutter_secure_storage`. On 401, attempts refresh then replays; on failure calls `logout()` (clears storage).
- **`providers/`** — Riverpod `FutureProvider`/`AsyncNotifier`. `authProvider` bootstraps by checking secure storage for an existing token and fetching `/users/me`.
- **`widgets/gantt_widget.dart`** — custom canvas-based mini Gantt (no third-party Gantt lib). Renders horizontal bars; only shows tasks that have both `startDate` and `endDate`.
- API base URL is injected at build time via `--dart-define=API_BASE_URL=...`; defaults to `http://10.0.2.2:8000/api/v1`.

### Notification delivery pipeline
Every task/project mutation → `notification_service.py` → simultaneously:
1. INSERT into `notifications` table (in-app feed)
2. `send_push_to_multiple()` → Firebase Admin SDK → FCM
3. `ws_manager.broadcast_to_project()` → open WebSocket connections
4. `aiosmtplib` email for relevant events (assignment, reminders, audits, deadline/escalation scenarios where configured)

Email dispatch observability:
- `email_dispatch_logs` table stores every send attempt/result:
  - `status`: `sent` | `failed` | `skipped`
  - `source`: event source (`task_assigned`, `team_status_reminder`, `management_gap_report`, etc.)
  - masked recipient projection is returned by API
- API endpoint: `GET /notifications/activity/email`

Celery Beat triggers `check_deadlines` at `:00` every hour, which scans for tasks with `end_date == today+1`, `today+3`, or `< today` and calls `notify_deadline()`.

## Key Configuration

All settings come from `.env` via `backend/app/core/config.py` (Pydantic Settings). Docker Compose injects database/Redis URLs via `environment:` blocks, overriding `.env` values.

Required before features work:
- **Google OAuth**: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `VITE_GOOGLE_CLIENT_ID`
- **Push notifications**: `firebase-credentials.json` at `FIREBASE_CREDENTIALS_PATH` (Firebase gracefully skips if file is absent)
- **Email**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAILS_FROM` (used by assignment/reminder/audit notifications; dispatches tracked in `email_dispatch_logs`)
- **Project files storage**: `PROJECT_FILES_DIR` points to a writable directory. In production, mount this directory as a persistent volume.
- **Vault storage**: `VAULT_FILES_DIR` (default `uploads/vault`) — persistent volume in production. `VAULT_ENCRYPTION_KEY` — 64-char hex string (32-byte AES master key). Generate: `python3 -c "import os; print(os.urandom(32).hex())"`. Falls back to `SHA-256(SECRET_KEY)` with a warning if unset.
- **Telegram summaries**: `TELEGRAM_BOT_ENABLED=true`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_TIMEZONE` (default `Asia/Yekaterinburg`), optional `TELEGRAM_ADMIN_USER_IDS` (comma-separated IDs; if empty, only Telegram chat admins can execute commands).

## Production Security (VPS: 168.222.194.92)

Current hardening state on the live server. Re-check these items after infra changes so the docs do not become confident fiction.

### SSH
- `PasswordAuthentication no` — only key auth
- `PermitRootLogin prohibit-password` — root login only by key
- `X11Forwarding no`
- **fail2ban** active on port 22: `maxretry=3`, `bantime=86400s`

### Firewall & Ports
- UFW default deny-incoming. Explicitly allowed: `22/tcp`, `443/tcp`, `1194/udp`
- **Docker bypasses UFW** — use `iptables -I DOCKER-USER` to restrict Docker-exposed ports
- `awg-easy` VPN admin panel bound to `127.0.0.1:8080` (not public)
- PostgreSQL (5432) and Redis (6379) — internal Docker network only, not exposed to host

### Nginx
- `/docs`, `/openapi.json`, `/redoc` — blocked (return 404). API schema not public.
- Security headers: `HSTS`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`
- TLS 1.2/1.3 only

### Secrets
- `.env.prod` permissions: `600` (root only)
- PostgreSQL password: strong random hex (not the default `planner`)
- Redis password set via `requirepass`

### SSL Certificate
- Provider: Let's Encrypt. Expires: **2026-05-23**. No auto-renewal configured — renew manually before expiry.
- Cert location: `nginx/ssl/fullchain.pem` + `privkey.pem`

## Database

PostgreSQL 16. Async driver: `asyncpg`. Sync driver (Alembic only): `psycopg2`.

Migration chain (`backend/alembic/versions/`):
| # | File | What it adds |
|---|------|-------------|
| 0001 | `initial.py` | Core tables: users, projects, project_members, tasks, task_comments, task_events, notifications, devices |
| 0002 | `project_files.py` | `project_files` table |
| 0003 | `task_extensions.py` | Escalation fields on tasks |
| 0004 | `escalation_sla_and_project_checklist.py` | SLA hours, completion checklist JSONB |
| 0005 | `task_progress_and_next_step.py` | `progress_percent`, `next_step` |
| 0006 | `ai_ingestion_and_drafts.py` | `ai_ingestion_jobs`, `ai_task_drafts` |
| 0007 | `user_is_active.py` | `users.is_active` flag |
| 0008 | `launch_basis_and_control_ski.py` | `control_ski`, `launch_basis_*` fields |
| 0009 | `user_permissions.py` | Granular permissions: `can_delete`, `can_import`, `can_bulk_edit` |
| 0010 | `deadline_changes.py` | `deadline_changes` audit table |
| 0011 | `task_event_reason.py` | `reason` column on `task_events` |
| 0012 | `user_work_email_and_team_status_notifications.py` | `users.work_email`, `team_status_reminder` notification type |
| 0013 | `task_checkin_fields.py` | `last_check_in_at`, `next_check_in_due_at`, `last_check_in_note` on tasks |
| 0014 | `org_and_task_dependencies.py` | `departments` table; `position_title`, `manager_id`, `department_id` on users; task dependencies |
| 0015 | `vault.py` | `vault_files` table for encrypted team storage |
| 0016 | `project_departments.py` | `project_departments` table for manual project-to-department assignment |
| 0017 | `task_assignees.py` | many-to-many assignees (`task_assignees`) + migration from `assigned_to_id` |
| 0018 | `task_status_planning.py` | adds `planning` value to `task_status` enum (default task status) |
| 0019 | `email_dispatch_logs.py` | `email_dispatch_logs` table for SMTP activity monitor in sidebar |

Alembic runs automatically on container start via the `command:` in `docker-compose.yml`.

Redis uses 3 databases: `/0` = general cache, `/1` = Celery broker, `/2` = Celery result backend.
