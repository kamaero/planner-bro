# Дизайн: система уведомлений об обновлениях (Changelog Modal)

**Дата:** 2026-04-24  
**Статус:** Согласован  

---

## Обзор

При входе в систему пользователь видит модальное окно «Что нового» — если с момента его последнего входа обновился `CHANGELOG.md`. Модалка показывается ровно один раз: после закрытия не появляется до следующего обновления changelog.

---

## Жизненный цикл

```
Логин
  → GET /me возвращает last_seen_changelog_hash
  → GET /api/v1/changelog возвращает {hash, sections}
  → hash != last_seen_changelog_hash
      → фильтр: sections где date > last_seen_changelog_date
      → показать ChangelogModal
  → пользователь нажимает «Понятно»
      → POST /api/v1/changelog/dismiss
      → hash и date записаны в БД
      → модалка закрыта, больше не показывается до следующего обновления
```

---

## Обновление CHANGELOG.md

В конце каждой рабочей сессии Claude читает `git log`, пишет новую секцию в `CHANGELOG.md` в существующем формате и коммитит вместе с кодом. Никакой автоматизации через git hooks — ручной контроль качества текста.

---

## Бэкенд

### Миграция `0041_changelog_seen`

Два новых поля в таблице `users`:

| Поле | Тип | Default |
|------|-----|---------|
| `last_seen_changelog_hash` | `VARCHAR(64) NULL` | `NULL` |
| `last_seen_changelog_date` | `DATE NULL` | `NULL` |

### Сервис `backend/app/services/changelog_service.py`

- Читает `CHANGELOG.md` (путь задаётся через env `CHANGELOG_PATH`, fallback — `/app/CHANGELOG.md`)
- В `docker-compose.yml` и `docker-compose.prod.yml` добавить volume-mount: `./CHANGELOG.md:/app/CHANGELOG.md:ro`
- Вычисляет SHA-256 содержимого файла как версию
- Парсит секции по шаблону `## [версия] — ГГГГ-ММ-ДД — заголовок`
- Возвращает список `ChangelogSection(version, date, title, content)`
- Кэш в памяти: при совпадении `mtime` файла не перечитывает

### Роутер `backend/app/routes/v1/changelog.py`

**`GET /api/v1/changelog`** — только для авторизованных пользователей

Ответ:
```json
{
  "hash": "abc123...",
  "sections": [
    {
      "version": "0.23",
      "date": "2026-04-24",
      "title": "Система уведомлений об обновлениях",
      "content": "### Добавлено\n- ..."
    }
  ]
}
```

**`POST /api/v1/changelog/dismiss`** — обновляет `last_seen_changelog_hash` и `last_seen_changelog_date` текущего пользователя (date = дата самой свежей секции из текущего ответа).

### Изменения в `/me`

Схема ответа `UserMe` дополняется полями:
- `last_seen_changelog_hash: str | None`
- `last_seen_changelog_date: str | None` (ISO-дата)

---

## Фронтенд

### Хук `frontend/src/hooks/useChangelogModal.ts`

- Вызывается в `AppLayout` после авторизации
- Запрашивает `GET /api/v1/changelog`
- Сравнивает `hash` с `user.last_seen_changelog_hash` из auth-стора
- Если отличаются — фильтрует секции по условию `date > last_seen_changelog_date`
- Если `last_seen_changelog_date === null` (первый вход) — берёт только первую (самую свежую) секцию
- Возвращает `{ isOpen, sections, dismiss }`

### Компонент `frontend/src/components/ChangelogModal/ChangelogModal.tsx`

- Использует `Dialog` из `@/components/ui` (как в остальных модалках проекта)
- Заголовок: **«Что нового в Planner Bro»**
- Список секций сверху вниз:
  - Версия + дата — жирный заголовок
  - Контент: `### Добавлено` → зелёный подзаголовок, `### Исправлено` → синий подзаголовок
  - Простой кастомный markdown-рендерер (без внешних зависимостей — split по строкам)
- Скроллится при большом количестве секций (`max-h` + `overflow-y-auto`)
- Одна кнопка «Понятно» → вызывает `dismiss()` из хука

### Интеграция в `App.tsx`

`ChangelogModal` рендерится внутри `AppLayout`. Хук `useChangelogModal` вызывается там же, рядом с `useWebSocket`.

---

## Граничные случаи

| Случай | Поведение |
|--------|-----------|
| Первый вход (last_seen_changelog_date = null) | Показываем только самую свежую секцию |
| Хэш совпадает | Модалка не открывается |
| Файл CHANGELOG.md недоступен | Ошибка логируется, модалка не показывается (graceful fail) |
| Пользователь закрыл без нажатия «Понятно» (Escape / клик вне) | Считается просмотренным — вызываем dismiss |

---

## Что не входит в скоуп

- Telegram-уведомления об обновлениях
- Административный UI для редактирования changelog
- Push-уведомления в мобильное приложение (Flutter)
- Принудительный показ конкретным пользователям
