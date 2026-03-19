# PlannerBro — Source of Truth

Обновлено: 2026-03-19

## Зачем нужен этот документ

Этот файл отвечает на один очень важный вопрос:

где в проекте находится “главная правда” по конкретной теме.

Без такого документа система начинает жить по принципу:

- backend думает одно;
- frontend показывает второе;
- mobile подмигивает третье;
- оператор потом ищет виноватого среди кофе и логов.

## Базовое правило

Для каждой доменной сущности должен быть один главный источник истины.

Остальные места:

- либо используют этот источник;
- либо являются производными представлениями;
- либо должны быть приведены к этому состоянию в рамках техдолга.

## 1. Роли, visibility и permissions

### Главный источник истины

- backend ORM и backend schemas:
  - `backend/app/models/user.py`
  - `backend/app/schemas/user.py`

### Где реализуется поведение

- доступ и scope:
  - `backend/app/services/access_scope.py`
- backend-проверки чувствительных действий:
  - `backend/app/api/v1/projects.py`
  - `backend/app/api/v1/tasks.py`
  - `backend/app/api/v1/notifications.py`

### Производные представления

- web UI:
  - `frontend/src/types/index.ts`
  - `frontend/src/pages/Team.tsx`
  - `frontend/src/pages/ProjectDetail.tsx`
  - `frontend/src/pages/Help.tsx`
- mobile UI:
  - `mobile/lib/models/user.dart`
  - `mobile/lib/screens/settings_screen.dart`

### Текущее замечание

Именно backend должен считаться главным источником для ролей и прав.

Web и mobile сейчас местами повторяют контракт вручную, поэтому это зона обязательной будущей синхронизации.

## 2. Статусы проектов

### Главный источник истины

- backend model/schema уровня проекта:
  - `backend/app/models/project.py`
  - `backend/app/schemas/project.py`

### Производные представления

- web:
  - `frontend/src/types/index.ts`
  - `frontend/src/pages/ProjectDetail.tsx`
  - `frontend/src/components/ProjectCard/ProjectCard.tsx`
- mobile:
  - `mobile/lib/widgets/project_card_widget.dart`
  - `mobile/lib/screens/dashboard_screen.dart`

### Текущее замечание

Сейчас проектные статусы используются в нескольких UI-слоях вручную.
Нужно свести это к единому документированному словарю.

## 3. Статусы задач

### Главный источник истины

- backend model/schema уровня задач:
  - `backend/app/models/task.py`
  - `backend/app/schemas/task.py`

### Поведенческая логика

- backend task lifecycle и проверки:
  - `backend/app/api/v1/tasks.py`
  - частично `backend/app/api/v1/projects.py`

### Производные представления

- web:
  - `frontend/src/types/index.ts`
  - `frontend/src/pages/ProjectDetail.tsx`
  - `frontend/src/pages/Analytics.tsx`
- mobile:
  - `mobile/lib/widgets/task_card_widget.dart`
  - `mobile/lib/screens/dashboard_screen.dart`

### Текущее замечание

Здесь уже есть явное дублирование label-словарей и отображений.
Это один из самых дешёвых и полезных кандидатов на унификацию.

## 4. Приоритеты

### Главный источник истины

- backend task/project schema и модели;
- backend-правило `control_ski -> critical`.

### Поведенческая логика

- backend:
  - `backend/app/api/v1/projects.py`
  - `backend/app/api/v1/tasks.py`

### Производные представления

- web:
  - `frontend/src/types/index.ts`
  - `frontend/src/pages/ProjectDetail.tsx`
  - `frontend/src/pages/Analytics.tsx`
- mobile:
  - `mobile/lib/widgets/task_card_widget.dart`
  - `mobile/lib/widgets/gantt_widget.dart`
  - `mobile/lib/screens/dashboard_screen.dart`

## 5. Контракт realtime и notification events

### Главный источник истины

- backend events:
  - `backend/app/services/events.py`

### Производные представления

- web event constants:
  - `frontend/src/api/events.ts`
- обработка web realtime:
  - `frontend/src/hooks/useWebSocket.ts`

### Текущее замечание

Контракт событий уже ближе к единому состоянию, чем роли и статусы.
Это хорошая база, которую стоит сохранить аккуратной.

## 6. Текущая бизнес-логика доступа

### Главный источник истины

- `backend/app/services/access_scope.py`

### Где это проявляется в UI

- web:
  - `frontend/src/App.tsx`
  - `frontend/src/pages/Team.tsx`
  - `frontend/src/pages/ProjectDetail.tsx`
  - `frontend/src/components/TaskDrawer/TaskDrawer.tsx`
- mobile:
  - пока в меньшей степени и частично через получаемые данные

### Текущее замечание

Правило простое:

- backend определяет, что разрешено;
- UI может скрывать или показывать элементы;
- UI не должен считаться последней инстанцией правды.

## 7. Импорт и AI ingestion

### Главный источник истины

- backend import / ingestion pipeline:
  - `backend/app/services/ms_project_import_service.py`
  - `backend/app/services/ai_ingestion_service.py`
  - `backend/app/tasks/ai_ingestion.py`
  - участки orchestration в `backend/app/api/v1/projects.py`

### Производные представления

- web import UX:
  - `frontend/src/pages/ProjectDetail.tsx`
  - `frontend/src/pages/Help.tsx`

## 8. Deploy и ops

### Главный источник истины

- deploy scripts:
  - `scripts/deploy-prod.sh`
  - `scripts/deploy-prod-git.sh`
  - связанные smoke-check scripts
- ops docs:
  - `README.md`
  - `CLAUDE.md`
  - `docs/ru/18_Чеклист_нового_продового_сервера.md`

### Текущее замечание

Для deploy особенно важно различать:

- то, что лежит в коммитах;
- то, что лежит в локальной рабочей директории;
- то, что реально ушло на сервер.

## Что нужно сделать следующим

Следующие улучшения по этой теме:

- выделить единые словари статусов и приоритетов;
- сократить ручное дублирование в web/mobile;
- сделать документ `Проверки и верификация`, чтобы source of truth был не только у правил, но и у способа проверки.
