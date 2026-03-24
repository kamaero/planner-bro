# Changelog

All notable changes to planner-bro are recorded here, grouped by logical release.

---

## [0.20] — 2026-03-24 — Workload Calendar & External Contractors

### Added
- **Workload calendar** (`/Загрузка`) — week/month view with department filter; cells colour-coded by load level (green ≤80 %, yellow ≤100 %, orange ≤125 %, red >125 %); tooltip shows tasks with project/priority/status
- **External dependencies** — contractors/blockers per task with statuses: `waiting` / `testing` / `received` / `overdue`; auto-upgrades to `overdue` when `due_date < today`
- **Global contractor list** in Team section (`/team` → "Внешние исполнители") — add/delete by name
- **Contractors column** in List view of project tasks — colour-coded badges (blue = waiting/testing, green = received, red = overdue)
- Batch endpoint `GET /projects/{id}/external-deps` — single query instead of N+1 per task
- DB migrations: `0037_task_external_deps`, `0038_external_contractors`

### Fixed
- Workload calendar showed no data — tasks assigned via `assigned_to_id` (legacy FK) were invisible; now both `TaskAssignee` join table and `assigned_to_id` are queried and deduplicated
- `/workload` and `/external-contractors` routes returned 404 — FastAPI matched them as `/{user_id}`; fixed by moving static routes before the parameterised catch-all
- Migration 0037 failed with `KeyError: '0036'` — `down_revision` was `'0036'` but the stored head was `'0036_custom_fields'`
- Task creation 500 — `from sqlalchemy.orm import inspect` doesn't exist in SQLAlchemy 2.x; fixed to `from sqlalchemy import inspect`
- External dep save 500 — `due_date` string caused `asyncpg DataError`; fixed with `_parse_date()` helper that converts to `datetime.date`
- Task save broken after opening ExternalDepsPanel — missing `data-enter-ignore="true"` meant Enter in the contractor form triggered the global TaskDrawer save
- External contractor writes not persisted — `await db.flush()` without `await db.commit()`; fixed all write paths

---

## [0.19] — 2026-03 — Dependency Graph, Time Tracking, Retrospective, Custom Fields

### Added
- **Dependency graph visualisation** — React Flow + dagre auto-layout; shows task-to-task blocking relationships with critical path highlighting
- **Time tracking** — planned vs actual hours per task; project-level time summary endpoint
- **AI project retrospective** — auto-generated report on the Analytics page when a project closes
- **Custom fields per project** — admins define typed fields (text, number, date, select); values stored per task; DB migrations 0020–0036

---

## [0.18] — 2026-03 — Anti-Spam, Permissions 2.0, Bulk Edit 2.0, AI Project Manager

### Added
- Anti-spam digest: deduplicates notification emails; configurable quiet hours
- HTML email digests with JWT action buttons (approve/reject directly from email)
- Permissions 2.0: granular `can_delete`, `can_import`, `can_bulk_edit` flags enforced in API
- Bulk edit 2.0: deadline shift + move-to-project for selected tasks
- AI Project Manager: on-demand analysis + nightly scan + weekly digest
- Email test mode for debugging SMTP without real delivery

---

## [0.17] — 2026-02 — Service Layer Refactor & New Pages

### Added
- Full service-layer refactor from codex branch: thin route handlers delegate to `services/` modules (task_service, project_service, notification_service, etc.)
- DB migrations 0027–0033 (various schema additions from the refactor)
- `/my-tasks` page — per-user task inbox
- `/help` page — inline documentation

### Changed
- API routes split into domain-specific service modules; route files now import from `services/`

---

## [0.16] — 2026-02 — Activity Heatmap & Bug Fixes

### Added
- GitHub-style activity heatmap in Analytics page (commits/events per day)

### Fixed
- Subtask / department / manager cycle detection (prevented infinite loops in org-structure queries)
- Email dispatch log TTL (old logs auto-cleaned)
- Bulk edit error propagation

---

## [0.15] — 2026-01 — Multi-Assignee & Planning Status

### Added
- Multi-assignee support on tasks (many-to-many `task_assignees` table, migration 0017)
- `planning` task status (migration 0018)
- Task list sorting by status / deadline / assignee
- Dashboard "my projects" mode filter

### Fixed
- Task create payload: always strips `assignee_ids` from ORM kwargs before direct field assignment
- Alembic chain for task assignees migration numbering conflict
- Dashboard department filtering edge cases
- Project edit modal: closes immediately and restores on save error

---

## [0.14] — 2026-01 — Unified File Import & Dashboard UX

### Added
- Unified project file upload pipeline: handles `.mpp`, `.xls`, `.xml`, `.pdf` in a single endpoint
- Dashboard deadline neon highlights and escalation blink toggle
- Task import: improved deterministic numbering from plan files
- Select-all toggle for AI draft approval

---

## [0.13] — 2025-12 — Department Dashboard & Telegram Bot

### Added
- Department-based IT dashboard (`/projects/dashboard/departments`) — project tiles grouped by department with manual project-to-department linking
- Scheduled Telegram summaries: per-project and critical-task digests (configurable timezone)
- Telegram bot commands: `/start`, `/stop`, `/stats` with admin permission gating
- Users can edit their own display name in the team card (`PUT /users/me`)

---

## [0.12] — 2025-12 — Vault, Dependencies, Presence

### Added
- **Secure team vault** — AES-256-GCM encrypted file storage; per-file keys via HKDF-SHA256; signed 15-min download JWTs; `vault_files` table (migration 0015)
- **Task dependencies** — predecessor/successor relationships; dependency graph service; API CRUD (`/tasks/{id}/dependencies`)
- Org structure admin: departments (hierarchical), `manager_id` / `department_id` on users (migration 0014)
- Online presence — `GET /users/online/presence` returns users with active WebSocket connections; sidebar shows green/red dots; polled every 30 s
- Self-service password change (`PUT /users/me/password`)

---

## [0.11] — 2025-11 — Audit Trail & Check-ins

### Added
- Deadline change audit trail — mandatory `deadline_change_reason` on every `end_date` change; `deadline_changes` table (migration 0010); history shown in TaskDrawer and ProjectDetail
- `reason` column on `task_events` (migration 0011)
- Task check-ins — `POST /tasks/{id}/check-in`; fields: `last_check_in_at`, `next_check_in_due_at`, `last_check_in_note` (migration 0013)
- Team notifications: deep-links to tasks from push/email, management audit log
- `DeadlineReasonModal` intercepts saves in TaskDrawer and ProjectDetail

---

## [0.10] — 2025-11 — Notion-Style Table View

### Added
- Notion-style table view for project tasks (list/table toggle in ProjectDetail)
- Inline status change from table view without opening drawer
- Task number column (hierarchical numbering via `buildTaskNumbering`)
- Deadline history collapsible section in TaskDrawer

---

## [0.9] — 2025-10 — Excalidraw Collab & AI Improvements

### Added
- Self-hosted Excalidraw collaborative whiteboard; sidebar link; team board page at `/team-board`
- AI switched to DeepSeek direct (OpenRouter fallback); improved grounding (strict quote extraction)
- Deterministic `.doc` plan table parsing before LLM fallback
- Login flow stabilised; accidental password resets prevented

---

## [0.8] — 2025-09 — Permissions, AI Trigger, Performance

### Added
- Granular team permissions (`can_delete`, `can_import`, `can_bulk_edit`) enforced in API (migration 0009)
- Manual AI file processing trigger with progress UI
- IT-specific project templates
- Bulk task update endpoint (`POST /projects/{id}/tasks/bulk`) + frontend multi-select list actions

### Changed
- Code splitting (Vite dynamic imports); task list virtualisation for large projects; Gantt capped at 150 tasks

---

## [0.7] — 2025-09 — Production Hardening

### Added
- VPS deploy scripts (`scripts/deploy_backend.sh`, `scripts/deploy_frontend.sh`)
- Nginx: blocked `/docs`, `/openapi.json`, `/redoc`; security headers; TLS 1.2/1.3 only
- fail2ban on SSH; UFW rules; Docker network isolation for PostgreSQL + Redis
- Production backup and health-check tasks (Celery Beat)
- WebSocket stability: server-side heartbeat + client reconnect
- `launch_basis` milestone fields + Gantt display; `control_ski` flag on tasks (migration 0008)

---

## [0.6] — 2025-08 — Team Management & Notifications

### Added
- Team management page (`/team`) — user list, roles, org structure
- View-all access model: users with `role="viewer"` see all projects read-only
- Actionable notifications (task link in notification dropdown)
- Improved notification readability (grouped by project)
- Disabled Google OAuth and self-registration (internal-only mode)

---

## [0.5] — 2025-07 — AI Import & Task Extensions

### Added
- AI file-to-draft pipeline: upload PDF/doc → Celery ingestion job → AI extracts tasks → approval flow (`ai_ingestion_jobs`, `ai_task_drafts` tables, migration 0006)
- MS Project XML import (`POST /projects/{id}/import/msproject`)
- Task progress bar + next-step quick update (migration 0005)
- 7-day task changes widget on Dashboard

---

## [0.4] — 2025-06 — Analytics & Deploy Pipeline

### Added
- Analytics page with per-project and global metrics
- Current-year activity chart on Dashboard
- Frontend: Vite prebuilt dist deployment (no Node on VPS at runtime)

### Fixed
- Analytics: stable hook order; guard against missing task dates
- Frontend prod build pipeline on VPS

---

## [0.3] — 2025-05 — Escalations & SLA

### Added
- Escalation workflow — overdue tasks escalated to manager; inbox view for assignees
- Escalation SLA (hours threshold before escalation fires) — migration 0004
- Bottleneck dashboard widget
- Definition-of-Done (DoD) completion gates — project-level checklist (JSONB)
- Dark theme toggle
- Members panel in project detail
- Email assignment notifications (`aiosmtplib` + Celery Beat deadline checker — migration 0003)

---

## [0.2] — 2025-04 — Infrastructure & Mobile

### Added
- Android project (Flutter) + GitHub Actions APK build workflow
- SSL/HTTPS via Let's Encrypt for `plannerbro.ru`
- Docker Compose `docker-compose.prod.yml` with Nginx reverse proxy
- VITE_GOOGLE_CLIENT_ID build arg wired through docker-compose

### Fixed
- Deployment issues on EU VPS

---

## [0.1] — 2025-03 — Foundation

### Added
- Initial FastAPI backend with async SQLAlchemy + PostgreSQL
- Core tables: users, projects, project_members, tasks, task_comments, task_events, notifications, devices (migration 0001)
- React SPA frontend with Vite; Gantt chart (gantt-task-react); TanStack Query data layer
- JWT auth (access + refresh tokens); Zustand auth store
- Nginx → FastAPI proxy configuration; Docker Compose dev stack
- Project files upload/download (migration 0002)
