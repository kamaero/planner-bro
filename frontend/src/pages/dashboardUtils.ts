import type { SystemActivityLog } from '@/types'

export function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export const PROJECT_TEMPLATES: Record<string, Array<{ title: string; priority: string; daysOffset: number }>> = {
  blank: [],
  launch: [
    { title: 'Сбор требований', priority: 'high', daysOffset: 2 },
    { title: 'План работ и оценка', priority: 'high', daysOffset: 5 },
    { title: 'Риски и план коммуникаций', priority: 'medium', daysOffset: 7 },
  ],
  support: [
    { title: 'Мониторинг SLA', priority: 'high', daysOffset: 1 },
    { title: 'Обзор инцидентов', priority: 'medium', daysOffset: 3 },
    { title: 'План улучшений', priority: 'medium', daysOffset: 7 },
  ],
}

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  active: 'Активный',
  testing: 'Тестирование',
  on_hold: 'На паузе',
  completed: 'Завершен',
}

export const TASK_STATUS_LABEL: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  todo: 'К выполнению',
  in_progress: 'В работе',
  testing: 'Тестирование',
  review: 'На проверке',
  done: 'Выполнено',
}

export const PROJECT_KIND_LABEL: Record<string, string> = {
  major_project: 'Крупный проект',
  department_plan: 'План отдела',
  competence_center: 'ЦК / аутсорсинг',
  initiative_portfolio: 'Портфель инициатив',
  service_inbox: 'Служебный inbox',
  local_project: 'Локальный проект',
}

export const REPORT_VISIBILITY_LABEL: Record<string, string> = {
  always: 'В доклад',
  watch: 'Мониторинг',
  risks_only: 'Только при рисках',
  hidden: 'Не включать',
}

export const IT_QUOTES = [
  'Любой баг становится фичей, если его не чинить достаточно долго.',
  'Работает в проде? Значит, трогать это нужно очень аккуратно.',
  'Нет ничего более постоянного, чем временное IT-решение.',
  'Дедлайн был вчера, но зато архитектура сегодня красивая.',
  'Если всё упало, начни с перезапуска. Потом сделай вид, что так и было.',
  'Логи не врут. Просто иногда говорят намеками.',
  'Код без комментариев как квест: интересно, но больно.',
  'Тесты пишут не для QA, а для будущего себя в пятницу вечером.',
  'Автоматизируй рутину: у человека есть дела поважнее паники.',
  'Главное правило релиза: сначала бэкап, потом смелость.',
]

export function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru')
}

export function humanizeTaskUpdateTime(value?: string): string {
  if (!value) return 'нет данных'
  const updatedAt = new Date(value)
  if (Number.isNaN(updatedAt.getTime())) return 'нет данных'

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const updatedDayStart = new Date(updatedAt.getFullYear(), updatedAt.getMonth(), updatedAt.getDate())
  const diffDays = Math.floor((todayStart.getTime() - updatedDayStart.getTime()) / (1000 * 60 * 60 * 24))

  const timePart = updatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (diffDays <= 0) return `сегодня, ${timePart}`
  if (diffDays === 1) return `вчера, ${timePart}`
  if (diffDays === 2) return `позавчера, ${timePart}`
  if (diffDays <= 7) return `на прошлой неделе (${updatedAt.toLocaleDateString('ru-RU')})`
  return updatedAt.toLocaleDateString('ru-RU')
}

export function parseDateOnly(value?: string | null): Date | null {
  if (!value) return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10) - 1
  const day = Number.parseInt(match[3], 10)
  return new Date(year, month, day, 12, 0, 0, 0)
}

export function daysUntil(dateValue?: string | null): number | null {
  const target = parseDateOnly(dateValue)
  if (!target) return null
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0)
  return Math.round((target.getTime() - startToday.getTime()) / (1000 * 60 * 60 * 24))
}

export function deadlinePulseClass(days: number | null, animate = true): string {
  if (days === null) return ''
  const pulse = animate ? ' animate-pulse' : ''
  if (days >= 0 && days <= 7) return `border-red-400 shadow-[0_0_10px_rgba(239,68,68,0.35)]${pulse}`
  if (days >= 10 && days <= 14) return `border-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.42)]${pulse}`
  if (days > 14 && days <= 20) return `border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.38)]${pulse}`
  return ''
}

export function myTaskUrgencyClass(days: number | null): string {
  if (days === null) return 'hover:bg-accent'
  if (days < 0) return 'border-red-600 shadow-[0_0_14px_rgba(220,38,38,0.55)] animate-pulse'
  if (days <= 1) return 'border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse'
  if (days <= 3) return 'border-red-400 shadow-[0_0_10px_rgba(248,113,113,0.42)] animate-pulse'
  if (days <= 7) return 'border-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.35)]'
  return 'hover:bg-accent'
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return `rgba(99,102,241,${alpha})`
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function isDigestQueueLog(item: SystemActivityLog): boolean {
  return item.source === 'analytics_email' && item.message.toLowerCase().includes('email digest queue tick')
}
