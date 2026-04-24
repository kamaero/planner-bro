# Changelog Notification Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a «Что нового» modal on first login after CHANGELOG.md is updated, listing only sections newer than the user's last seen date.

**Architecture:** Backend service parses CHANGELOG.md into structured sections (version, date, title, content) with SHA-256 hash and mtime-based cache. Two new columns on `users` track last-seen hash and date. New `/api/v1/changelog` endpoints serve sections and handle dismiss. Frontend hook compares hashes on app boot and filters new sections; modal uses existing shadcn Dialog.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend), React + Zustand + shadcn/ui Dialog (frontend).

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `backend/alembic/versions/0042_changelog_seen.py` | Migration: two new columns on users |
| Modify | `backend/app/models/user.py` | Add `last_seen_changelog_hash`, `last_seen_changelog_date` |
| Create | `backend/app/services/changelog_service.py` | Parse CHANGELOG.md, compute hash, cache by mtime |
| Create | `backend/app/api/v1/changelog.py` | GET /changelog, POST /changelog/dismiss |
| Modify | `backend/app/main.py` | Register changelog router |
| Modify | `backend/app/schemas/user.py` | Expose new fields in UserOut |
| Modify | `docker-compose.yml` | Mount CHANGELOG.md into backend container |
| Modify | `docker-compose.prod.yml` | Same for production |
| Modify | `frontend/src/types/index.ts` | Add ChangelogSection, ChangelogResponse, extend User |
| Create | `frontend/src/hooks/useChangelogModal.ts` | Fetch changelog, compare hash, filter sections |
| Create | `frontend/src/components/ChangelogModal/ChangelogModal.tsx` | Modal UI with section renderer |
| Modify | `frontend/src/App.tsx` | Wire hook + modal into AppLayout |
| Modify | `CHANGELOG.md` | Add v0.24 entry for this feature |

---

### Task 1: User model + migration

**Files:**
- Modify: `backend/app/models/user.py`
- Create: `backend/alembic/versions/0042_changelog_seen.py`

- [ ] **Step 1: Add columns to User model**

In `backend/app/models/user.py`, add `Date` to the SQLAlchemy import and `date` to the datetime import:

```python
from datetime import datetime, date, timezone
from sqlalchemy import String, DateTime, Date, Enum as SAEnum, Boolean, ForeignKey
```

Add two columns after `email_notifications_enabled`:

```python
    last_seen_changelog_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_seen_changelog_date: Mapped[date | None] = mapped_column(Date, nullable=True)
```

- [ ] **Step 2: Create migration**

Create `backend/alembic/versions/0042_changelog_seen.py`:

```python
"""add changelog seen tracking to users

Revision ID: 0042_changelog_seen
Revises: 0041_task_number
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa

revision = '0042_changelog_seen'
down_revision = '0041_task_number'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('last_seen_changelog_hash', sa.String(64), nullable=True))
    op.add_column('users', sa.Column('last_seen_changelog_date', sa.Date(), nullable=True))


def downgrade():
    op.drop_column('users', 'last_seen_changelog_date')
    op.drop_column('users', 'last_seen_changelog_hash')
```

- [ ] **Step 3: Run migration**

```bash
cd /root/projects/planner-bro/backend && alembic upgrade head
```

Expected output includes: `Running upgrade 0041_task_number -> 0042_changelog_seen`

- [ ] **Step 4: Commit**

```bash
cd /root/projects/planner-bro
git add backend/app/models/user.py backend/alembic/versions/0042_changelog_seen.py
git commit -m "feat: add last_seen_changelog_hash/date to users (migration 0042)"
```

---

### Task 2: Changelog service

**Files:**
- Create: `backend/app/services/changelog_service.py`

- [ ] **Step 1: Create service**

Create `backend/app/services/changelog_service.py`:

```python
import hashlib
import os
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path


@dataclass
class ChangelogSection:
    version: str
    date: str   # ISO "YYYY-MM-DD"
    title: str
    content: str


_SECTION_RE = re.compile(
    r'^## \[([^\]]+)\]\s*[—–-]+\s*(\d{4}-\d{2}-\d{2})\s*[—–-]+\s*(.+)$',
    re.MULTILINE,
)

_cache: dict = {"hash": None, "mtime": None, "sections": []}


def _changelog_path() -> Path:
    return Path(os.getenv("CHANGELOG_PATH", "/app/CHANGELOG.md"))


def get_changelog() -> dict:
    path = _changelog_path()
    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        return {"hash": "", "sections": []}

    if _cache["mtime"] == mtime:
        return {"hash": _cache["hash"], "sections": _cache["sections"]}

    content = path.read_text(encoding="utf-8")
    file_hash = hashlib.sha256(content.encode()).hexdigest()
    sections = _parse_sections(content)

    _cache["mtime"] = mtime
    _cache["hash"] = file_hash
    _cache["sections"] = sections

    return {"hash": file_hash, "sections": sections}


def _parse_sections(content: str) -> list[ChangelogSection]:
    matches = list(_SECTION_RE.finditer(content))
    sections = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        section_content = content[start:end].strip()
        sections.append(ChangelogSection(
            version=m.group(1).strip(),
            date=m.group(2).strip(),
            title=m.group(3).strip(),
            content=section_content,
        ))
    return sections
```

- [ ] **Step 2: Sanity check the parser**

```bash
cd /root/projects/planner-bro/backend && python3 -c "
import os; os.environ['CHANGELOG_PATH'] = '../CHANGELOG.md'
from app.services.changelog_service import get_changelog
result = get_changelog()
print('hash:', result['hash'][:12])
print('sections:', len(result['sections']))
if result['sections']:
    s = result['sections'][0]
    print('latest:', s.version, s.date, s.title[:40])
"
```

Expected: prints hash, count ≥ 20, and first section version/date/title.

- [ ] **Step 3: Commit**

```bash
cd /root/projects/planner-bro
git add backend/app/services/changelog_service.py
git commit -m "feat: add changelog_service — parses CHANGELOG.md with mtime cache"
```

---

### Task 3: Changelog router

**Files:**
- Create: `backend/app/api/v1/changelog.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create router**

Create `backend/app/api/v1/changelog.py`:

```python
from datetime import date
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.changelog_service import get_changelog

router = APIRouter(prefix="/changelog", tags=["changelog"])


@router.get("")
async def get_changelog_endpoint(current_user: User = Depends(get_current_user)):
    return get_changelog()


@router.post("/dismiss")
async def dismiss_changelog(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = get_changelog()
    sections = data["sections"]
    latest_date: date | None = None
    if sections:
        try:
            latest_date = date.fromisoformat(sections[0].date)
        except ValueError:
            pass

    current_user.last_seen_changelog_hash = data["hash"]
    current_user.last_seen_changelog_date = latest_date
    await db.commit()
    return {"ok": True}
```

- [ ] **Step 2: Register in main.py**

In `backend/app/main.py`, update the import line:

```python
from app.api.v1 import (
    auth, projects, tasks, users, org, temp_assignees, login_events,
    notifications, vault, chat, analytics, email_actions, ai_analysis, changelog
)
```

After the last `app.include_router(...)` call, add:

```python
app.include_router(changelog.router, prefix="/api/v1")
```

- [ ] **Step 3: Commit**

```bash
cd /root/projects/planner-bro
git add backend/app/api/v1/changelog.py backend/app/main.py
git commit -m "feat: add GET /api/v1/changelog and POST /api/v1/changelog/dismiss"
```

---

### Task 4: Expose fields in /me response

**Files:**
- Modify: `backend/app/schemas/user.py`

- [ ] **Step 1: Add date import and new fields to UserOut**

In `backend/app/schemas/user.py`, add `date` to the datetime import:

```python
from datetime import datetime, date
```

In the `UserOut` class, add after `last_login_at`:

```python
    last_seen_changelog_hash: Optional[str] = None
    last_seen_changelog_date: Optional[date] = None
```

- [ ] **Step 2: Verify /me returns new fields**

Start backend: `cd backend && uvicorn app.main:app --reload`

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"aerokamero@gmail.com","password":"YOUR_PASS"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/users/me \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('hash:', d.get('last_seen_changelog_hash')); print('date:', d.get('last_seen_changelog_date'))"
```

Expected: `hash: None` and `date: None`

- [ ] **Step 3: Commit**

```bash
cd /root/projects/planner-bro
git add backend/app/schemas/user.py
git commit -m "feat: expose last_seen_changelog_hash/date in UserOut schema"
```

---

### Task 5: Mount CHANGELOG.md in Docker

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Add volume to dev docker-compose**

In `docker-compose.yml`, find the `backend` service `volumes:` block and add:

```yaml
      - ./CHANGELOG.md:/app/CHANGELOG.md:ro
```

- [ ] **Step 2: Add volume to prod docker-compose**

In `docker-compose.prod.yml`, find the `backend` service `volumes:` block and add:

```yaml
      - ./CHANGELOG.md:/app/CHANGELOG.md:ro
```

- [ ] **Step 3: Commit**

```bash
cd /root/projects/planner-bro
git add docker-compose.yml docker-compose.prod.yml
git commit -m "chore: mount CHANGELOG.md into backend container (dev + prod)"
```

---

### Task 6: Frontend types + API methods

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Extend User type and add new interfaces**

In `frontend/src/types/index.ts`, in the `User` interface add after `last_login_at`:

```ts
  last_seen_changelog_hash?: string | null
  last_seen_changelog_date?: string | null
```

Add these new interfaces (after the `User` interface):

```ts
export interface ChangelogSection {
  version: string
  date: string   // "YYYY-MM-DD"
  title: string
  content: string
}

export interface ChangelogResponse {
  hash: string
  sections: ChangelogSection[]
}
```

- [ ] **Step 2: Add API methods**

In `frontend/src/api/client.ts`, add a `// Changelog` section at the end of the `api` object (before the closing `}`):

```ts
  // Changelog
  getChangelog: () =>
    apiClient.get('/changelog').then((r) => r.data),

  dismissChangelog: () =>
    apiClient.post('/changelog/dismiss').then((r) => r.data),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /root/projects/planner-bro/frontend && npm run build 2>&1 | grep -i "error\|warning" | head -20
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
cd /root/projects/planner-bro
git add frontend/src/types/index.ts frontend/src/api/client.ts
git commit -m "feat: add ChangelogSection/ChangelogResponse types and API methods"
```

---

### Task 7: useChangelogModal hook

**Files:**
- Create: `frontend/src/hooks/useChangelogModal.ts`

- [ ] **Step 1: Create hook**

Create `frontend/src/hooks/useChangelogModal.ts`:

```ts
import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/api/client'
import type { ChangelogSection } from '@/types'

export function useChangelogModal() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const [isOpen, setIsOpen] = useState(false)
  const [sections, setSections] = useState<ChangelogSection[]>([])
  const [currentHash, setCurrentHash] = useState('')

  useEffect(() => {
    if (!user) return

    api.getChangelog().then((data: { hash: string; sections: ChangelogSection[] }) => {
      if (!data.hash || data.hash === user.last_seen_changelog_hash) return

      const lastDate = user.last_seen_changelog_date ?? null
      const newSections = lastDate
        ? data.sections.filter((s) => s.date > lastDate)
        : data.sections.slice(0, 1)

      if (newSections.length === 0) return

      setCurrentHash(data.hash)
      setSections(newSections)
      setIsOpen(true)
    }).catch(() => {
      // changelog unavailable — silently skip
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const dismiss = async () => {
    setIsOpen(false)
    try {
      await api.dismissChangelog()
      if (user) {
        setUser({
          ...user,
          last_seen_changelog_hash: currentHash,
          last_seen_changelog_date: sections[0]?.date ?? user.last_seen_changelog_date,
        })
      }
    } catch {
      // non-critical — user sees it again next login
    }
  }

  return { isOpen, sections, dismiss }
}
```

- [ ] **Step 2: Commit**

```bash
cd /root/projects/planner-bro
git add frontend/src/hooks/useChangelogModal.ts
git commit -m "feat: add useChangelogModal hook"
```

---

### Task 8: ChangelogModal component

**Files:**
- Create: `frontend/src/components/ChangelogModal/ChangelogModal.tsx`

- [ ] **Step 1: Create component**

Create `frontend/src/components/ChangelogModal/ChangelogModal.tsx`:

```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ChangelogSection } from '@/types'

interface Props {
  open: boolean
  sections: ChangelogSection[]
  onDismiss: () => void
}

function renderContent(content: string) {
  return content.split('\n').map((line, i) => {
    if (line.startsWith('### ')) {
      const heading = line.slice(4)
      const color =
        heading.includes('Добавлено') || heading.includes('Added')
          ? 'text-green-600 dark:text-green-400'
          : heading.includes('Исправлено') || heading.includes('Fixed')
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-muted-foreground'
      return (
        <p key={i} className={`font-semibold text-sm mt-3 mb-1 ${color}`}>
          {heading}
        </p>
      )
    }
    if (line.startsWith('- **')) {
      const parts = line.slice(2).split('**')
      return (
        <li key={i} className="text-sm ml-4 list-disc leading-relaxed">
          {parts.map((p, j) =>
            j % 2 === 1 ? <strong key={j}>{p}</strong> : <span key={j}>{p}</span>
          )}
        </li>
      )
    }
    if (line.startsWith('- ')) {
      return (
        <li key={i} className="text-sm ml-4 list-disc leading-relaxed text-muted-foreground">
          {line.slice(2)}
        </li>
      )
    }
    if (line.trim() === '' || line.startsWith('---')) return null
    return (
      <p key={i} className="text-sm text-muted-foreground">
        {line}
      </p>
    )
  })
}

export function ChangelogModal({ open, sections, onDismiss }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDismiss() }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0">
        <DialogHeader className="pb-4">
          <DialogTitle>Что нового в Planner Bro</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 pr-1 space-y-6">
          {sections.map((section) => (
            <div key={section.version}>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="font-bold text-base">[{section.version}]</span>
                <span className="text-sm text-muted-foreground">
                  {new Date(section.date + 'T00:00:00').toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                <span className="text-sm font-medium truncate">{section.title}</span>
              </div>
              <ul className="space-y-0.5">{renderContent(section.content)}</ul>
            </div>
          ))}
        </div>
        <div className="pt-4 border-t mt-4">
          <Button onClick={onDismiss} className="w-full">
            Понятно
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /root/projects/planner-bro
git add frontend/src/components/ChangelogModal/ChangelogModal.tsx
git commit -m "feat: add ChangelogModal component"
```

---

### Task 9: Integrate into App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add imports at the top of App.tsx**

After the existing imports block, add:

```tsx
import { useChangelogModal } from '@/hooks/useChangelogModal'
import { ChangelogModal } from '@/components/ChangelogModal/ChangelogModal'
```

- [ ] **Step 2: Call hook in AppLayout**

In the `AppLayout` function body, after the `useWebSocket()` call, add:

```tsx
  const changelog = useChangelogModal()
```

- [ ] **Step 3: Render modal in AppLayout return**

Inside the `AppLayout` return, in the outermost `<div className="min-h-screen bg-background flex">`, add `ChangelogModal` after `</aside>`:

```tsx
      <ChangelogModal
        open={changelog.isOpen}
        sections={changelog.sections}
        onDismiss={changelog.dismiss}
      />
```

- [ ] **Step 4: Build to verify no errors**

```bash
cd /root/projects/planner-bro/frontend && npm run build 2>&1 | tail -10
```

Expected: `✓ built in X.Xs` with no errors.

- [ ] **Step 5: Commit**

```bash
cd /root/projects/planner-bro
git add frontend/src/App.tsx
git commit -m "feat: integrate ChangelogModal into AppLayout"
```

---

### Task 10: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Prepend new section at the top of CHANGELOG.md**

Add after the `# История изменений` header and `---` divider:

```markdown
## [0.24] — 2026-04-24 — Система уведомлений об обновлениях

### Добавлено
- **Changelog-модалка** — при первом входе после обновления системы пользователь видит модальное окно «Что нового» со списком изменений с момента последнего входа; при первом входе показывается только самая свежая секция
- **Отслеживание просмотра** — после нажатия «Понятно» (или закрытия модалки) окно не появляется до следующего обновления CHANGELOG.md; хэш файла и дата последней просмотренной секции хранятся в БД на пользователя
- **Автоматическая фильтрация** — если пользователь пропустил несколько обновлений, показываются все секции новее его последнего входа

---
```

- [ ] **Step 2: Commit**

```bash
cd /root/projects/planner-bro
git add CHANGELOG.md
git commit -m "docs: add v0.24 changelog entry for notification modal"
```

---

### Task 11: Manual smoke test (dev)

- [ ] **Step 1: Start dev stack**

```bash
cd /root/projects/planner-bro && docker-compose up -d
```

- [ ] **Step 2: Test the modal appears**

Open `http://localhost` in browser. Log in. Expect: changelog modal appears (all users have `last_seen_changelog_hash = NULL` → shows latest section).

- [ ] **Step 3: Test dismiss**

Click «Понятно». Log out, log back in. Expect: modal does NOT appear.

- [ ] **Step 4: Test new update detection**

Add a new line anywhere in `CHANGELOG.md` → log out → log back in. Expect: modal appears again.

---

### Task 12: Deploy to production

- [ ] **Step 1: Push to GitHub**

```bash
cd /root/projects/planner-bro && git push github main
```

- [ ] **Step 2: Pull and rebuild on VPS**

```bash
ssh planner_bro "cd /opt/planner-bro && git pull"
ssh planner_bro "cd /opt/planner-bro/frontend && npm run build"
ssh planner_bro "cd /opt/planner-bro && docker compose -f docker-compose.prod.yml up -d --build backend celery_worker celery_beat"
ssh planner_bro "cd /opt/planner-bro && docker compose -f docker-compose.prod.yml restart nginx"
```

Migration 0042 runs automatically on backend container start.

- [ ] **Step 3: Verify on prod**

Log into the live site. Expect: changelog modal appears for all users (first time). Click «Понятно» → modal dismissed, won't reappear until next CHANGELOG.md update.
