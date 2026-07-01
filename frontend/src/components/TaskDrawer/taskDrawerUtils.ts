export const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

export const STATUS_OPTIONS = ['planning', 'tz', 'todo', 'in_progress', 'testing', 'review', 'done'] as const

export const DEPENDENCY_TYPE_LABELS: Record<string, string> = {
  finish_to_start: 'FS (Окончание-Начало)',
  start_to_start: 'SS (Начало-Начало)',
  finish_to_finish: 'FF (Окончание-Окончание)',
}

export const STATUS_LABELS: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  todo: 'К выполнению',
  in_progress: 'В работе',
  testing: 'Тестирование',
  review: 'На проверке',
  done: 'Выполнено',
}

export function formatTaskEvent(eventType: string, payload?: string | null) {
  if (eventType === 'task_created') return 'Задача создана'
  if (eventType === 'task_deleted') return 'Задача удалена'
  if (eventType === 'task_imported_from_ms_project') return 'Импортировано из MS Project'
  if (eventType === 'task_created_from_ai_draft') return 'Создано из AI-черновика'
  if (eventType === 'task_created_from_recurrence') return 'Создано повторение задачи'
  if (eventType === 'comment_added') return 'Добавлен комментарий'
  if (eventType === 'escalation_first_response') return 'Отмечена первая реакция по эскалации'
  if (eventType === 'check_in_recorded') return 'Выполнен check-in'

  if (eventType === 'status_changed') {
    if (!payload) return 'Статус обновлен'
    const [from, to] = payload.split('->')
    if (!to) return `Статус: ${payload}`
    return `Статус: ${STATUS_LABELS[from] ?? from} → ${STATUS_LABELS[to] ?? to}`
  }
  if (eventType === 'progress_updated') return `Прогресс: ${payload ?? ''}%`
  if (eventType === 'next_step_updated') return `Следующий шаг: ${payload || '—'}`
  if (eventType === 'assignee_changed') {
    if (!payload) return 'Исполнитель изменен'
    return `Изменен исполнитель (${payload})`
  }
  if (eventType === 'date_changed') {
    if (!payload) return 'Дата изменена'
    const colonIdx = payload.indexOf(':')
    if (colonIdx === -1) return `Дата изменена: ${payload}`
    const field = payload.slice(0, colonIdx)
    const change = payload.slice(colonIdx + 1)
    const arrowIdx = change.indexOf('->')
    const from = arrowIdx === -1 ? change : change.slice(0, arrowIdx)
    const to = arrowIdx === -1 ? '' : change.slice(arrowIdx + 2)
    const label = field === 'end' ? 'Дедлайн' : 'Дата начала'
    return `${label}: ${from || '—'} → ${to || '—'}`
  }

  return payload ? `${eventType} (${payload})` : eventType
}
