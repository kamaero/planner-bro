# PlannerBro — План реализации и TODO

Обновлено: 2026-03-19

## Зачем нужен этот документ

Этот файл — рабочий план реализации, по которому можно продолжать проект без долгого погружения.

Он нужен для двух типов читателей:

- человеку-оператору, чтобы быстро видеть текущий фокус и следующий шаг;
- LLM-coder, чтобы не гадать, что делать дальше и в каком порядке.

## Правила использования

- Если меняется приоритет работ, обновите этот файл в том же изменении.
- Если задача завершена, перенесите её в блок `Сделано` или отметьте как выполненную.
- Если появляется новый риск, добавьте его в раздел `Риски и блокеры`.
- Если код меняет архитектуру, одновременно обновите связанные документы из раздела `Связанные документы`.

## Связанные документы

- [02_Текущее состояние проекта](./02_Текущее_состояние_проекта.md)
- [03_Архитектурная память проекта](./03_Архитектурная_память_проекта.md)
- [04_Workflow документации и синхронизации](./04_Workflow_документации_и_синхронизации.md)
- [05_Multi-Mac workflow](./05_Multi-Mac_workflow.md)
- [PlannerBro_TODO.md](../../PlannerBro_TODO.md)

## Главный принцип

Сначала уменьшаем стоимость понимания проекта, потом уменьшаем стоимость изменения проекта.

Перевод с архитектурного на человеческий: сначала раскладываем инструменты по местам, потом чиним двигатель.

## Wave 1 — Внешняя память проекта

Цель: сделать документацию рабочим источником истины для текущего состояния, правил работы и синхронизации между машинами.

### A. Каркас памяти

- [x] Создать рабочий TODO-файл реализации.
- [x] Зафиксировать текущее состояние проекта отдельным документом.
- [x] Зафиксировать архитектурную память проекта отдельным документом.
- [x] Зафиксировать workflow обновления документации и синхронизации.
- [x] Зафиксировать workflow переключения между разными Mac.
- [x] Добавить документ `Source of Truth` по ролям, статусам, правам и событиям.
- [x] Добавить документ `Code Map` по backend / frontend / mobile / ops.

### B. Навигация по документации

- [x] Обновить портал документации и сделать его точкой входа.
- [x] Обновить README ссылками на новую структуру памяти проекта.
- [x] Добавить короткие ссылки “что читать первым” для оператора, разработчика и LLM.

## Wave 2 — Контракты и проверяемость

Цель: уменьшить скрытые расхождения между backend, frontend и mobile.

### A. Доменные контракты

- [x] Зафиксировать единый словарь статусов проектов.
- [x] Зафиксировать единый словарь статусов задач.
- [x] Зафиксировать единый словарь приоритетов.
- [x] Зафиксировать матрицу ролей и visibility scope.
- [x] Зафиксировать отдельные permissions: `can_delete`, `can_import`, `can_bulk_edit`, `can_manage_team`.
- [x] Зафиксировать контракт realtime / notification events.

### B. Проверки качества

- [x] Создать единый документ `Проверки и верификация`.
- [x] Описать быстрые проверки для локальной работы.
- [x] Описать полные проверки перед merge / deploy.
- [x] Добавить единый локальный `check`-вход для frontend + backend smoke suite.
- [x] Добавить скрипт подготовки backend check environment на Python 3.12.
- [x] Вынести task smoke rules в отдельный сервис, чтобы smoke-тесты не импортировали весь `tasks.py`.
- [x] Добавить облегчённый `backend/requirements-check.txt` для smoke-верификации.
- [ ] Привести backend-тесты к полностью бесшовному запуску одной официальной командой без ручной подготовки окружения.
- [x] Добавить минимальные контрактные тесты на права, статусы, зависимости и planning modes.

## Wave 3 — Тяжёлый техдолг и упрощение кода

Цель: сократить размер самых перегруженных модулей и убрать дублирование правил.

### A. Backend

- [ ] Разрезать `backend/app/api/v1/projects.py` на use-case модули.
- [ ] Разрезать `backend/app/api/v1/tasks.py` на use-case модули.
- [ ] Унести бизнес-правила из роутов в services / use-cases.
- [ ] Зафиксировать и закоммитить вынос task access / assignee orchestration из `backend/app/api/v1/tasks.py` в `backend/app/services/task_access_service.py`.
- [ ] Добавить карту backend-модулей.

### B. Frontend

- [x] Вынести files/AI секцию из `frontend/src/pages/ProjectDetail.tsx` в `frontend/src/components/ProjectFilesSection/ProjectFilesSection.tsx`.
- [x] Вынести toolbar списка задач из `frontend/src/pages/ProjectDetail.tsx` в `frontend/src/components/ProjectTaskListToolbar/ProjectTaskListToolbar.tsx`.
- [x] Вынести диалог создания задачи из `frontend/src/pages/ProjectDetail.tsx` в `frontend/src/components/ProjectTaskCreateDialog/ProjectTaskCreateDialog.tsx`.
- [x] Вынести диалог редактирования проекта из `frontend/src/pages/ProjectDetail.tsx` в `frontend/src/components/ProjectEditDialog/ProjectEditDialog.tsx`.
- [x] Вынести task-list state и bulk-handlers из `frontend/src/pages/ProjectDetail.tsx` в `frontend/src/hooks/useProjectTaskListState.ts`.
- [ ] Продолжить разрезание `frontend/src/pages/ProjectDetail.tsx` на секции и hooks.
- [x] Разрезать `frontend/src/App.tsx` на layout / search / sidebar / telemetry (`components/App/*`, `useClientErrorTelemetry`).
- [x] Разрезать `frontend/src/pages/Team.tsx` на секции и hooks (`components/Team/*`, `useTeamReportSettings`, `useTeamUsersAdminState`).
- [x] Разрезать `frontend/src/pages/Dashboard.tsx` на секции и hooks (`DashboardProjectsSection`, `DashboardOpsSignalsSection`, `DashboardTasksSection`, `DashboardDialogs`, `useDashboardMetrics`).
- [ ] Убрать дублирование словарей статусов и приоритетов.

### C. Mobile

- [ ] Сверить mobile-контракты со словарями web/backend.
- [ ] Убрать ручное дублирование статусов и label-словарей там, где это возможно.
- [ ] Добавить карту mobile-модулей.

## Ближайшие практические шаги

Это список, который нужно брать в работу следующим, без философии и танцев с бубном:

1. Довести backend checks до полностью бесшовного запуска без ручной подготовки окружения.
2. Зафиксировать текущий локальный вынос task access-логики из `tasks.py` в отдельный сервис и обновить связанную документацию.
3. Продолжить разрезание `projects.py` после вынесения `project_rules_service.py` и `project_access_service.py`.
4. Продолжить следующую итерацию рефакторинга `frontend/src/pages/ProjectDetail.tsx`.
5. Добавить drift-guards для mobile/web словарей и runtime-обработчиков событий.

## Риски и блокеры

- Локальная рабочая директория не чистая, поэтому состояние `origin` и состояние “что реально лежит локально” сейчас различаются.
- Backend smoke-проверки стали легче и воспроизводимее, но пока всё ещё требуют предварительного `setup-backend-check-env.sh`.
- Правила ролей, visibility и статусов уже частично дублируются между backend, frontend и mobile.
- Presence / realtime пока завязаны на in-memory состояние одного процесса, что ограничивает дальнейшее масштабирование.

## Сделано

- [x] Проведён первичный архитектурный аудит локальной кодовой базы.
- [x] Зафиксирован факт: ветка синхронизирована с `origin` по коммитам, но рабочая директория локально не идентична репозиторию.
- [x] Сформирован поэтапный roadmap из 3 волн.
- [x] Создан каркас внешней памяти проекта в `docs/ru`.
- [x] Добавлены документы `Source of Truth` и `Code Map`.
- [x] Добавлен документ `20_Доменные_контракты.md` с каноническими словарями статусов/приоритетов, матрицей ролей/scope, permissions и realtime-event контрактом.
- [x] Зафиксирован порядок работы с ветками в `21_Git_ветки_и_порядок.md` и добавлен helper `scripts/git-branch-lanes.sh`.
- [x] Создан документ `Проверки и верификация`.
- [x] Добавлен единый локальный скрипт `scripts/check-local.sh`.
- [x] Добавлен скрипт `scripts/setup-backend-check-env.sh`.
- [x] Сделана первая безопасная итерация разгрузки `backend/app/api/v1/projects.py` через новый `project_rules_service.py`.
- [x] Вынесен AI draft approval use-case из `backend/app/api/v1/projects.py` в `backend/app/services/project_ai_draft_service.py`.
- [x] Сделана первая безопасная итерация разгрузки `backend/app/api/v1/tasks.py` через новый `task_rules_service.py`.
- [x] Локально начата следующая итерация разгрузки `backend/app/api/v1/tasks.py` через новый `task_access_service.py` и smoke-тест `backend/tests/test_task_access_service_smoke.py`.
- [x] Локально начата следующая итерация разгрузки `backend/app/api/v1/tasks.py` через новый `task_dependency_service.py` для dependency/autoplan-логики.
- [x] Сделана следующая безопасная итерация разгрузки `backend/app/api/v1/tasks.py` через новый `backend/app/services/task_lifecycle_service.py` (priority/escalation/check-in/parent rollup helpers).
- [x] Сделана следующая безопасная итерация разгрузки `backend/app/api/v1/tasks.py` через новый `backend/app/services/task_mutation_service.py` (status/check-in/recurrence mutation helpers).
- [x] Сделана следующая безопасная итерация разгрузки `backend/app/api/v1/tasks.py` через новый `backend/app/services/task_bulk_service.py` (bulk payload validation/normalization + field apply helpers).
- [x] Сделана следующая безопасная итерация разгрузки `backend/app/api/v1/tasks.py` через вынос query helper'ов (`get_task_with_assignees`, `list_escalations_for_assignee`) в `backend/app/services/task_service.py`.
- [x] Сделана следующая безопасная итерация разгрузки `backend/app/api/v1/tasks.py` через новый `backend/app/services/task_activity_service.py` (assignee/status events + notification orchestration helpers).
- [x] Добавлен `backend/tests/test_domain_contracts_smoke.py` с контрактными smoke-проверками статусов/приоритетов, ролей+visibility, permissions и sync realtime-events backend<->frontend.
- [x] Добавлен `backend/tests/test_mobile_domain_drift_smoke.py` с drift-проверками mobile-словарей статусов/приоритетов относительно backend канона.
- [x] Добавлен `backend/tests/test_task_lifecycle_service_smoke.py` для новой service-логики lifecycle helper'ов задач.
- [x] Добавлен `backend/tests/test_task_mutation_service_smoke.py` для новой service-логики status/check-in/recurrence mutation helper'ов задач.
- [x] Добавлен `backend/tests/test_task_bulk_service_smoke.py` для новой service-логики bulk payload/priority/field apply helper'ов задач.
- [x] Добавлен `backend/tests/test_task_service_smoke.py` для query helper'ов `task_service.py` (task refresh + escalation inbox).
- [x] Добавлен `backend/tests/test_task_activity_service_smoke.py` для service-логики assignee/status events и bulk notification orchestration.
- [x] Начата разгрузка frontend-слоя через вынос доменных UI-словарей в `frontend/src/lib/domainMeta.ts`.
- [x] Сделана первая безопасная итерация разгрузки `frontend/src/pages/ProjectDetail.tsx` через новый `ProjectFilesSection`.
- [x] Сделана вторая безопасная итерация разгрузки `frontend/src/pages/ProjectDetail.tsx` через новый `ProjectTaskListToolbar`.
- [x] Сделана третья безопасная итерация разгрузки `frontend/src/pages/ProjectDetail.tsx` через новый `ProjectTaskCreateDialog`.
- [x] Сделана четвёртая безопасная итерация разгрузки `frontend/src/pages/ProjectDetail.tsx` через новый `ProjectEditDialog`.
- [x] Сделана пятая безопасная итерация разгрузки `frontend/src/pages/ProjectDetail.tsx` через новый `useProjectTaskListState`.
- [x] Сделана шестая безопасная итерация разгрузки `frontend/src/pages/ProjectDetail.tsx` через вынос `ProjectDetailHeader` и `ProjectDetailSummaryCard`.
- [x] Сделана седьмая безопасная итерация разгрузки `frontend/src/pages/ProjectDetail.tsx` через вынос `ProjectDetailGanttSection` и `ProjectDetailTaskListSection`.
- [x] Сделана восьмая безопасная итерация разгрузки `frontend/src/pages/ProjectDetail.tsx` через вынос content-router в `ProjectDetailContent` и action-handlers в `useProjectDetailActions`.
- [x] Сделана девятая безопасная итерация разгрузки `frontend/src/pages/ProjectDetail.tsx` через вынос derived-логики в `useProjectDetailDerived` и selection/open-логики в `useProjectDetailTaskSelection`.
- [x] Проведена поэтапная разгрузка `frontend/src/pages/Team.tsx` через вынос секций в `frontend/src/components/Team/*`.
- [x] Вынесена логика report settings из `frontend/src/pages/Team.tsx` в `frontend/src/hooks/useTeamReportSettings.ts`.
- [x] Вынесены invite/name/permission drafts из `frontend/src/pages/Team.tsx` в `frontend/src/hooks/useTeamUsersAdminState.ts`.
- [x] Сделана первая безопасная итерация разгрузки `frontend/src/pages/Dashboard.tsx` через новый `frontend/src/components/Dashboard/DashboardProjectsSection.tsx`.
- [x] Вынесены блоки `Статусы и дедлайны` + `Сигналы контроля` из `frontend/src/pages/Dashboard.tsx` в `frontend/src/components/Dashboard/DashboardOpsSignalsSection.tsx`.
- [x] Вынесены блоки `Срочные задачи` + `Мои задачи` из `frontend/src/pages/Dashboard.tsx` в `frontend/src/components/Dashboard/DashboardTasksSection.tsx`.
- [x] Вынесены служебные модалки `System log` и `Назначить отделы проекту` в `frontend/src/components/Dashboard/DashboardDialogs.tsx`.
- [x] Вынесены derived-метрики `Dashboard` в `frontend/src/hooks/useDashboardMetrics.ts`.
- [x] Сделана первая безопасная итерация разгрузки `frontend/src/App.tsx` через вынос `CommandPaletteDialog`, `AppSidebar` и `useClientErrorTelemetry`.
