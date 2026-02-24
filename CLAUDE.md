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

### Production deploy
```bash
# Place Let's Encrypt certs in nginx/ssl/ (fullchain.pem, privkey.pem)
# Edit nginx/nginx.conf server_name
# Fill in .env.prod
# Ensure uploads directory exists for project files
mkdir -p uploads/projects
docker-compose -f docker-compose.prod.yml up -d --build
```

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
- **`models/`** — SQLAlchemy ORM. All PKs are `str` UUIDs. `ProjectMember` is a composite-PK join table (project_id + user_id). `Task.parent_task_id` is a self-referential FK for subtasks. `ProjectFile` stores uploaded files per project.
- **`schemas/`** — Pydantic request/response models, one file per domain. `GanttTask`/`GanttData` in `project.py` map directly to the `gantt-task-react` Task interface.
- **`api/v1/`** — thin route handlers. Authorization helpers (`_require_project_access`, `_require_project_member`) are local to each router file. `tasks.py` router has **no prefix** — task routes are split across `/projects/{id}/tasks` and `/tasks/{id}`. Project files live under `/projects/{id}/files` with upload/list/download/delete endpoints.
- **`services/`** — business logic. `notification_service.py` is the central fan-out point: every mutation calls a `notify_*` function which (1) writes DB records, (2) sends FCM via `firebase.py`, (3) broadcasts a WebSocket event via `ws_manager`.
- **`tasks/`** — Celery. `celery_app.py` defines the Beat schedule. `deadline_checker.py` uses `asyncio.run()` to call async DB code from a sync Celery task.

### Authorization model
- JWT access token in `Authorization: Bearer` header. `get_current_user` dependency validates it.
- Project access: a user must exist in `project_members` for that project (or have `role="admin"` to bypass).
- Manager-level mutations (update/delete project, manage members) require `ProjectMember.role` of `owner` or `manager`.

### Frontend (`frontend/src/`)
- **`store/authStore.ts`** — Zustand store. Only `refreshToken` is persisted (localStorage via `persist`). `accessToken` lives in memory only.
- **`api/client.ts`** — Axios instance with two interceptors: (1) attaches access token to every request, (2) on 401, calls `/auth/refresh`, saves new tokens, replays queued requests. All API functions are exported from `api` object here.
- **`hooks/useProjects.ts`** — all TanStack Query hooks for projects/tasks/files. On mutations, invalidates both `tasks` and `gantt` query keys since both derive from the same data.
- **`hooks/useWebSocket.ts`** — opens `ws://host/ws?token=...` on mount, dispatches `queryClient.invalidateQueries` on received events. No explicit reconnect logic.
- **`components/GanttChart/`** — wraps `gantt-task-react`. Converts `GanttTask[]` (from the `/gantt` endpoint) to the library's `Task[]` type via `toGanttTasks()`.
- **`pages/Dashboard.tsx`** — clickable KPI cards filter a project list (active/in-progress/overdue/completed) and add fast navigation via `ProjectCard` links.
- **`pages/ProjectDetail.tsx`** — project editing (name/status/dates/owner) and a Files tab for uploading and managing attachments.

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
4. (deadline_missed only) `aiosmtplib` email

Celery Beat triggers `check_deadlines` at `:00` every hour, which scans for tasks with `end_date == today+1`, `today+3`, or `< today` and calls `notify_deadline()`.

## Key Configuration

All settings come from `.env` via `backend/app/core/config.py` (Pydantic Settings). Docker Compose injects database/Redis URLs via `environment:` blocks, overriding `.env` values.

Required before features work:
- **Google OAuth**: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `VITE_GOOGLE_CLIENT_ID`
- **Push notifications**: `firebase-credentials.json` at `FIREBASE_CREDENTIALS_PATH` (Firebase gracefully skips if file is absent)
- **Email**: `SMTP_USER` + `SMTP_PASSWORD` (only deadline_missed events send email)
- **Project files storage**: `PROJECT_FILES_DIR` points to a writable directory. In production, mount this directory as a persistent volume.

## Production Security (VPS: 95.164.92.165)

Current hardening state on the live server (as of 2026-02-24):

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

Migration files: `backend/alembic/versions/0001_initial.py` (core tables/enums) and `0002_project_files.py` (project file storage). Alembic runs automatically on container start via the `command:` in `docker-compose.yml`.

Redis uses 3 databases: `/0` = general cache, `/1` = Celery broker, `/2` = Celery result backend.
