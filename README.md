# planner-bro

IT Project Management System for small teams (10–15 people).

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI (Python 3.12) + PostgreSQL 16 + Redis 7 |
| Frontend | React 18 + TypeScript + Vite + Tailwind + gantt-task-react |
| Mobile | Flutter 3.x + Riverpod 2 |
| Push | Firebase Cloud Messaging (Android + Web) |
| Auth | JWT (access 15min / refresh 7d) + Google OAuth2 |
| Background | Celery Beat (deadline checker every hour) |
| Infra | Docker + Nginx + Let's Encrypt |

## Quick Start (Development)

```bash
# 1. Copy and configure environment
cp .env.example .env

# 2. Start all services
docker-compose up --build

# Access:
# Web UI   → http://localhost:80
# API docs → http://localhost:8000/docs
# API      → http://localhost:8000/api/v1/
```

## Running Backend Locally (without Docker)

```bash
cd backend
pip install -r requirements.txt

# Start PostgreSQL and Redis separately, then:
alembic upgrade head
uvicorn app.main:app --reload
```

## Running Frontend Locally

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

## Running Flutter Mobile

```bash
cd mobile
flutter pub get

# Android emulator or device:
flutter run
```

**Requirements before running mobile:**
- Add your `google-services.json` to `mobile/android/app/`
- Set `API_BASE_URL` dart-define to point to your backend

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8000/api/v1
```

## Production Deployment (VPS)

```bash
# 1. Get SSL certificate (Let's Encrypt)
certbot certonly --standalone -d yourdomain.com
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/

# 2. Edit nginx/nginx.conf — replace server_name with your domain

# 3. Copy .env.example → .env.prod, fill in production values

# 4. First run on VPS (backend/infra)
docker compose -f docker-compose.prod.yml up -d --build

# 5. Next deploys from local machine (sync backend/infra + sync frontend dist)
./scripts/deploy-prod.sh

# Optional: deploy backend only
SKIP_FRONTEND=1 ./scripts/deploy-prod.sh
```

## Architecture

```
Browser / Flutter App
        │
        ▼
     Nginx (80/443)
     ┌────────┬────────────────┐
     │        │                │
  /api/v1   /ws          / (frontend)
     │        │
     ▼        ▼
  FastAPI (uvicorn)
     │
     ├── PostgreSQL (data)
     ├── Redis (cache + Celery broker)
     ├── Celery Worker (notifications)
     ├── Celery Beat (deadline checker)
     └── Firebase Admin (push notifications)
```

## API Endpoints

See full interactive docs at `http://localhost:8000/docs` after starting the backend.

Key endpoints:
- `POST /api/v1/auth/register` — create account
- `POST /api/v1/auth/login` — get JWT tokens
- `POST /api/v1/auth/refresh` — rotate refresh token pair
- `POST /api/v1/auth/logout` — revoke current refresh token
- `GET  /api/v1/projects/` — list user's projects
- `PATCH /api/v1/projects/{id}/members/{user_id}` — update member role (`member`/`manager`)
- `GET  /api/v1/projects/{id}/gantt` — Gantt-compatible task data
- `GET  /api/v1/projects/{id}/critical-path` — critical path based on task dependencies
- `GET  /api/v1/tasks/escalations/inbox` — escalated tasks assigned to current user
- `GET/POST /api/v1/tasks/{task_id}/comments` — task discussion thread
- `GET /api/v1/tasks/{task_id}/events` — task activity log
- `GET /api/v1/users/global/search?q=...` — global search (projects/tasks/users)
- `PUT /api/v1/users/me/reminders` — per-user deadline reminder days (e.g. `1,3,7`)
- `WS   /ws?token={access_token}` — real-time events

## Configuration

Copy `.env.example` to `.env` and set:

| Variable | Description |
|---|---|
| `SECRET_KEY` | JWT signing key — use a long random string in production |
| `GOOGLE_CLIENT_ID/SECRET` | From Google Cloud Console |
| `FIREBASE_CREDENTIALS_PATH` | Path to Firebase service account JSON |
| `SMTP_*` | SMTP settings for deadline email notifications |
| `VITE_GOOGLE_CLIENT_ID` | Used by frontend for Google OAuth button |

## Recent Improvements

- Session bootstrap on web app reload:
  if only `refreshToken` is present, frontend restores `accessToken` and user profile automatically.
- Secure refresh flow:
  refresh token rotation + revoke on logout (Redis-based).
- Project control model:
  only owner/admin can transfer ownership or grant manager role.
- Members management:
  role update directly in UI + backend guard rails.
- Task workflow UX:
  task list now supports search, status/assignee filters, multi-select, and bulk actions.
- Escalation workflow:
  deputies can mark tasks as escalation and route blockers to manager inbox.
- Templates and recurring work:
  project creation supports templates; tasks support repeat interval in days.
- Task collaboration:
  comments + activity history are available directly in task drawer.
- Search and reporting:
  global header search and analytics CSV export with date/project filters.
- Dependencies:
  task dependency selection + critical path block in project view.
- Escalation SLA:
  escalation tasks now support reaction SLA (hours), first-response tracking, and auto-overdue marking.
- Bottlenecks dashboard:
  dashboard highlights blocked tasks (dependency blockers) and overdue escalations.
- Definition of Done:
  project completion is now guarded by a mandatory completion checklist.
- Notifications:
  less noise for assignees and deduplication for repeated deadline checks.
