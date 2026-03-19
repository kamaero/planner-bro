# PlannerBro — Code Map

Обновлено: 2026-03-19

## Зачем нужен этот документ

Это карта проекта в формате “если хотите поменять X, идите сюда”.

Документ специально написан так, чтобы помогать:

- человеку без необходимости держать весь репозиторий в голове;
- LLM-coder без необходимости тратить полжизни на разведку.

## Быстрые маршруты

### Если нужно менять права и доступ

Смотрите сюда:

- `backend/app/services/access_scope.py`
- `backend/app/models/user.py`
- `backend/app/schemas/user.py`
- `backend/app/api/v1/users.py`
- `backend/app/api/v1/projects.py`
- `backend/app/api/v1/tasks.py`
- `frontend/src/pages/Team.tsx`
- `frontend/src/pages/ProjectDetail.tsx`

### Если нужно менять статусы задач и правила переходов

Смотрите сюда:

- `backend/app/models/task.py`
- `backend/app/schemas/task.py`
- `backend/app/api/v1/tasks.py`
- `frontend/src/types/index.ts`
- `frontend/src/pages/ProjectDetail.tsx`
- `frontend/src/pages/Analytics.tsx`
- `mobile/lib/widgets/task_card_widget.dart`
- `mobile/lib/screens/dashboard_screen.dart`

### Если нужно менять проекты и их lifecycle

Смотрите сюда:

- `backend/app/models/project.py`
- `backend/app/schemas/project.py`
- `backend/app/api/v1/projects.py`
- `backend/app/services/project_service.py`
- `backend/app/services/project_rules_service.py`
- `frontend/src/pages/ProjectDetail.tsx`
- `frontend/src/pages/Dashboard.tsx`

### Если нужно менять импорт и AI ingestion

Смотрите сюда:

- `backend/app/services/ms_project_import_service.py`
- `backend/app/services/ai_ingestion_service.py`
- `backend/app/tasks/ai_ingestion.py`
- orchestration в `backend/app/api/v1/projects.py`
- web UX в `frontend/src/pages/ProjectDetail.tsx`
- помощь пользователю в `frontend/src/pages/Help.tsx`

### Если нужно менять уведомления и realtime

Смотрите сюда:

- `backend/app/services/events.py`
- `backend/app/services/notification_service.py`
- `backend/app/services/websocket_manager.py`
- `backend/app/api/v1/notifications.py`
- `backend/app/main.py`
- `frontend/src/api/events.ts`
- `frontend/src/hooks/useNotifications.ts`
- `frontend/src/hooks/useWebSocket.ts`
- `frontend/src/components/NotificationBell/`

### Если нужно менять чат

Смотрите сюда:

- `backend/app/api/v1/chat.py`
- `backend/app/models/chat.py`
- `backend/app/services/chat_storage.py`
- `frontend/src/pages/Chat.tsx`

### Если нужно менять team vault

Смотрите сюда:

- `backend/app/models/vault.py`
- `backend/app/services/vault_crypto.py`
- `backend/app/api/v1/vault.py`
- `frontend/src/hooks/useVault.ts`
- `frontend/src/pages/TeamStorage.tsx`

### Если нужно менять mobile API-интеграцию

Смотрите сюда:

- `mobile/lib/core/api_client.dart`
- `mobile/lib/providers/`
- `mobile/lib/models/`

### Если нужно менять deploy и эксплуатацию

Смотрите сюда:

- `docker-compose.yml`
- `docker-compose.prod.yml`
- `scripts/`
- `nginx/`
- `README.md`
- `CLAUDE.md`
- `docs/ru/18_Чеклист_нового_продового_сервера.md`

## Карта по слоям

### Backend

- `backend/app/core`
  - конфигурация, безопасность, база, внешние клиенты.
- `backend/app/models`
  - сущности системы и их поля.
- `backend/app/schemas`
  - API-контракты.
- `backend/app/api/v1`
  - HTTP-вход в систему.
- `backend/app/services`
  - бизнес-логика и cross-cutting behavior.
- `backend/app/tasks`
  - фоновые задачи и периодика.

### Frontend

- `frontend/src/pages`
  - большие экранные сценарии.
- `frontend/src/components`
  - переиспользуемые UI-блоки.
- `frontend/src/hooks`
  - получение данных, invalidate, локальная orchestration.
- `frontend/src/api`
  - API-клиент и event constants.
- `frontend/src/store`
  - auth и theme state.
- `frontend/src/lib`
  - маленькие служебные функции.
- `frontend/src/types`
  - web-типизация домена.

### Mobile

- `mobile/lib/core`
  - API и инфраструктура.
- `mobile/lib/models`
  - модели данных.
- `mobile/lib/providers`
  - состояние и загрузка.
- `mobile/lib/screens`
  - экраны.
- `mobile/lib/widgets`
  - переиспользуемые визуальные блоки.

## Самые тяжёлые файлы, к которым относиться с уважением и перчатками

Если трогаете эти файлы, сначала прочитайте соседние документы памяти проекта:

- `backend/app/api/v1/projects.py`
- `backend/app/api/v1/tasks.py`
- `frontend/src/pages/ProjectDetail.tsx`
- `frontend/src/pages/Team.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/App.tsx`

Это не значит “не трогать”.
Это значит “не врываться с бензопилой без плана”.

## Рекомендуемый порядок чтения кода для нового агента

1. `docs/ru/00_Портал_PlannerBro.md`
2. `docs/ru/01_План_реализации_и_TODO.md`
3. `docs/ru/02_Текущее_состояние_проекта.md`
4. `docs/ru/03_Архитектурная_память_проекта.md`
5. Этот документ
6. Только после этого нужные файлы по задаче

## Следующее улучшение Code Map

Следующий логичный шаг:

- сделать отдельную карту `Проверки и верификация`;
- затем начать рефакторинг самых тяжёлых узлов по очереди, а не всем табуном сразу.
