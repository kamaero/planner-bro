# Refactoring Plan: Code Slimming

> Goal: thin files that fit in one LLM context window (≤ 500 lines per file).
> Approach: **surgical, incremental** — one extraction per commit, tests pass after each step.
> Reference: `codex/temp-assignees-and-ai-bulk` branch (do NOT merge — use as a blueprint only).

---

## Current state

| File | Lines | Routes / Components |
|------|-------|----------------------|
| `backend/app/api/v1/users.py` | 1 127 | 29 routes |
| `frontend/src/pages/ProjectDetail.tsx` | 2 067 | 6 view tabs + edit form |
| `frontend/src/pages/Team.tsx` | 2 058 | 5 section tabs + 30+ useState |

---

## Wave 1 — Backend: `users.py` (risk: LOW)

Routers are stateless — each extraction is an independent file with its own `APIRouter`.
Main `users.py` registers subrouters via `router.include_router()`.

### Step 1.1 — Extract `org.py` (~150 lines, 5 routes)
Routes: `/org/departments` CRUD + `/org/tree`
New file: `backend/app/api/v1/org.py`
Risk: zero — no shared state with rest of users.py.

### Step 1.2 — Extract `temp_assignees.py` (~200 lines, 5 routes)
Routes: `/temp-assignees`, `/temp-assignees/{id}/link`, `/ignore`, `/promote`
New file: `backend/app/api/v1/temp_assignees.py`
Note: `promote` handler is 70 lines — can stay inline for now.

### Step 1.3 — Extract `login_events.py` (~80 lines, 1 route)
Route: `GET /login-events` (lines ~364–443, 80 lines of inline filtering logic)
New file: `backend/app/api/v1/login_events.py`
Note: filtering logic → `backend/app/services/login_events_service.py`.

### Step 1.4 — Inline workload/presence cleanup
Routes: `GET /workload`, `GET /online/presence`
These already delegate to `workload_service.py` — just verify they're thin (< 20 lines each). No move needed if already clean.

### Result after Wave 1
`users.py` target: **~500 lines** (core CRUD: me, create, update, permissions, search, reset-password, delete, external-contractors).

---

## Wave 2 — Frontend: `ProjectDetail.tsx` (risk: MEDIUM)

Hooks already extracted (`useProjectDetailActions`, `useProjectDetailDerived`,
`useProjectDetailTaskSelection`, `useProjectTaskListState`).
Remaining work: extract **render sections** into components.

Extract order — safest first (pure render, no shared state mutations):

### Step 2.1 — Extract `ProjectDetailGanttSection` (~60 lines)
What: the `view === 'gantt'` branch + GanttChart wrapper
New file: `frontend/src/components/ProjectDetail/ProjectDetailGanttSection.tsx`
Props: `tasks`, `ganttData`, `isLoading`, `onTaskClick`
Risk: LOW — pure display, no state mutations.

### Step 2.2 — Extract `ProjectDetailFilesSection` (~150 lines)
What: the `view === 'files'` branch
New file: `frontend/src/components/ProjectDetail/ProjectDetailFilesSection.tsx`
Props: `projectId`, `files`, `onUpload`, `onDelete`, `vaultInfo`
Risk: LOW — isolated file operations.

### Step 2.3 — Extract `ProjectDetailHeader` (~120 lines)
What: top bar with project title, color dot, progress bar, action buttons, tab strip
New file: `frontend/src/components/ProjectDetail/ProjectDetailHeader.tsx`
Props: `project`, `view`, `onViewChange`, `onEditOpen`, `onDeleteConfirm`
Risk: LOW-MEDIUM — needs careful prop threading.

### Step 2.4 — Extract `ProjectEditDialog` (~800 lines)
What: the `editOpen` dialog with the full project edit form
New file: `frontend/src/components/ProjectEditDialog/ProjectEditDialog.tsx`
State to lift out: `editForm`, `showProjectDeadlineModal`, `pendingProjectFormData`
Risk: MEDIUM — large form with deadline-change modal flow. Test edit → save → deadline modal.
Reference: codex branch has this extracted at `src/components/ProjectEditDialog/ProjectEditDialog.tsx`.

### Step 2.5 — Extract `ProjectDetailListView` (~500 lines)
What: the `view === 'list'` branch — toolbar, bulk edit panel, task rows
New file: `frontend/src/components/ProjectDetail/ProjectDetailListView.tsx`
State to pass: filter/sort state from `useProjectTaskListState` (already a hook)
Risk: MEDIUM — bulk edit has many state pieces. Keep bulk state in the hook, pass callbacks down.

### Step 2.6 — Extract `ProjectSummaryCard` (~200 lines)
What: summary card below header (dates, members count, progress stats, deadline history)
New file: `frontend/src/components/ProjectDetail/ProjectSummaryCard.tsx`
Risk: LOW — read-only display.

### Result after Wave 2
`ProjectDetail.tsx` target: **~200 lines** (page shell: data fetching + routing between extracted sections).

---

## Wave 3 — Frontend: `Team.tsx` (risk: MEDIUM)

Section components already extracted (TeamOverviewSection, TeamOrgSection, etc.).
Problem: 30+ `useState` still inline — the page is a god-component.

Extract hooks in order of independence:

### Step 3.1 — Extract `useTeamCoreData` hook (~80 lines)
What: `users`, `departments`, loading/error state + `reload` callbacks (useEffect fetches)
New file: `frontend/src/hooks/useTeamCoreData.ts`
Risk: LOW — pure data fetching, no mutations.

### Step 3.2 — Extract `useTeamLoginEvents` hook (~60 lines)
What: `loginEvents`, `loginEventsLoading`, `loginEventsError` + load handler
New file: `frontend/src/hooks/useTeamLoginEvents.ts`
Risk: LOW — isolated fetch.

### Step 3.3 — Extract `useTeamInvite` hook (~80 lines)
What: `invite`, `inviting`, `inviteSuccess`, `inviteError` + `handleInvite`
New file: `frontend/src/hooks/useTeamInvite.ts`
Risk: LOW — isolated create flow.

### Step 3.4 — Extract `useTeamDepartmentCreate` hook (~70 lines)
What: `newDepartmentName/ParentId/HeadId`, `creatingDepartment` + `handleCreateDepartment`
New file: `frontend/src/hooks/useTeamDepartmentCreate.ts`
Risk: LOW — isolated create flow.

### Step 3.5 — Extract `useTeamTempAssignees` hook (~80 lines)
What: `tempAssignees` state + load/link/ignore/promote handlers
New file: `frontend/src/hooks/useTeamTempAssignees.ts`
Risk: MEDIUM — promote handler triggers users reload (cross-hook dependency). Pass `reloadUsers` callback from `useTeamCoreData`.

### Step 3.6 — Extract `useTeamOwnPassword` hook (~50 lines)
What: `changingOwnPassword`, `ownPasswordForm`, success/error + submit handler
New file: `frontend/src/hooks/useTeamOwnPassword.ts`
Risk: LOW — fully isolated.

### Result after Wave 3
`Team.tsx` target: **~200 lines** (page shell: section routing + hook composition).

---

## Wave 4 — Cleanup

- Delete remote branches `codex/hotfix-date-assignee-deps-20260304` and `codex/temp-assignees-and-ai-bulk` — they have served as the blueprint.
- Delete this file once all waves are done.

```bash
git push github --delete codex/hotfix-date-assignee-deps-20260304
git push github --delete codex/temp-assignees-and-ai-bulk
```

---

## Rules of engagement

1. **One extraction per commit** — never bundle two steps in one commit.
2. **No logic changes** — extraction only. Behaviour must be identical before and after.
3. **Check the app runs** after each step before moving to the next.
4. **Props over context** — prefer explicit props threading to adding new React contexts.
5. **Backend: keep services thin** — routers call services, services call DB. No business logic in routers.
