# PlannerBro

PlannerBro is an IT project execution system for department teams.  
Core goal: daily management discipline without micromanagement, with transparent status, deadlines, and accountability.

## What It Solves

- Daily project/task control for managers and team leads.
- Unified work area for projects, tasks, statuses, comments, dependencies, and deadlines.
- Operational reminders through in-app notifications, email, and Telegram summaries.
- Visibility of "what is happening right now" through online presence and background activity monitor.

## Core Capabilities

- Project and task management with status/progress workflow.
- Department-based dashboard (`Дэшборд IT`) with tabs by department and personal scope (`Мои проекты и задачи`).
- Gantt + LIST views, task sorting, bulk operations, and task dependencies (critical path support).
- Org structure and team administration (departments, heads, manager/subordinate hierarchy, permissions).
- Smart ingestion pipeline for source files and draft approval flow.
- Encrypted team storage (Vault).
- Reminder engine:
  - flexible check-in cadence,
  - extra rule for `control_ski=true` (daily reminders 5 days before deadline),
  - manager audit for projects/tasks without manager/admin assignment.
- Notification channels:
  - in-app notifications + WebSocket realtime,
  - email with deep links to project/task,
  - Telegram bot summaries (`/start`, `/stop`, `/stats`) with schedule support.
- Sidebar collaboration tools:
  - full team presence list (green=online, red=offline),
  - system activity monitor for SMTP dispatches (`sent/failed/skipped`).

## Technology Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI (Python 3.12), SQLAlchemy, Alembic |
| Database | PostgreSQL 16 |
| Queue/Scheduler | Celery + Celery Beat + Redis 7 |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query |
| Mobile | Flutter 3.x + Riverpod |
| Realtime | WebSocket |
| Notifications | FCM, SMTP, Telegram Bot API |
| Infra | Docker, Nginx, Let's Encrypt |

## Quick Start (Development)

```bash
cp .env.example .env
docker-compose up --build
```

- Web UI: `http://localhost:80`
- API docs: `http://localhost:8000/docs`

## Production Deploy

Preferred:

```bash
./scripts/deploy-prod.sh
```

Backend only:

```bash
SKIP_FRONTEND=1 ./scripts/deploy-prod.sh
```

## Key Config Areas (`.env`)

- Auth and security: `SECRET_KEY`, OAuth settings.
- Notifications: `SMTP_*`, `APP_WEB_URL`, `TEAM_STATUS_REMINDER_*`, `MANAGEMENT_AUDIT_*`.
- Telegram: `TELEGRAM_BOT_*`, `TELEGRAM_ADMIN_USER_IDS`.
- Vault encryption: `VAULT_ENCRYPTION_KEY`, `VAULT_FILES_DIR`.

## API Highlights

- `GET /api/v1/projects/dashboard/departments` — dashboard by departments.
- `GET /api/v1/users/online/presence` — online users.
- `GET /api/v1/notifications` — in-app notifications.
- `GET /api/v1/notifications/activity/email` — SMTP activity feed for sidebar monitor.
- `WS /ws?token=...` — realtime invalidation/events.

## Additional Docs

- Development/operator guide: [CLAUDE.md](./CLAUDE.md)
- Product backlog/TODO: [PlannerBro_TODO.md](./PlannerBro_TODO.md)
- Short system brief for announcements: [SYSTEM_OVERVIEW_RU.md](./SYSTEM_OVERVIEW_RU.md)
