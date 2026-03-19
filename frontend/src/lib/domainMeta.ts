export const TASK_STATUS_LABELS: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  todo: 'К выполнению',
  in_progress: 'В работе',
  testing: 'Тестирование',
  review: 'На проверке',
  done: 'Выполнено',
}

export const TASK_STATUS_ORDER: Record<string, number> = {
  planning: 0,
  tz: 1,
  todo: 2,
  in_progress: 3,
  testing: 4,
  review: 5,
  done: 6,
}

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
}

export const TASK_PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export const TASK_PRIORITY_BADGE_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

export const TASK_PRIORITY_CHART_COLORS: Record<string, string> = {
  low: '#3b82f6',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
}

export const TASK_STATUS_CHART_COLORS: Record<string, string> = {
  planning: '#0ea5e9',
  tz: '#06b6d4',
  todo: '#94a3b8',
  in_progress: '#6366f1',
  testing: '#8b5cf6',
  review: '#f59e0b',
  done: '#22c55e',
}

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  active: 'Активный',
  testing: 'Тестирование',
  on_hold: 'Пауза',
  completed: 'Завершён',
}

export const PROJECT_STATUS_OPTIONS = [
  { value: 'planning', label: 'Планирование' },
  { value: 'tz', label: 'ТЗ' },
  { value: 'active', label: 'Активный' },
  { value: 'testing', label: 'Тестирование' },
  { value: 'on_hold', label: 'Пауза' },
  { value: 'completed', label: 'Завершён' },
] as const

export const PROJECT_STATUS_BADGE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  planning: 'secondary',
  tz: 'outline',
  active: 'default',
  testing: 'outline',
  on_hold: 'outline',
  completed: 'secondary',
}
