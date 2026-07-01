import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ReportTaskSummary, SystemActivityLog } from '@/types'
import { cn, daysUntil, myTaskUrgencyClass, deadlinePulseClass, TASK_STATUS_LABEL, formatDate, IT_QUOTES, isDigestQueueLog } from './dashboardUtils'
import { SectionCard } from './SectionCard'

function pickDifferentQuoteIndex(prev: number): number {
  if (IT_QUOTES.length <= 1) return 0
  let next = Math.floor(Math.random() * IT_QUOTES.length)
  while (next === prev) next = Math.floor(Math.random() * IT_QUOTES.length)
  return next
}

/** Компактные бейджи сигналов контроля в хэдере дэшборда. */
export function SignalBadges({
  created,
  updated,
  completed,
  stale,
  escalations,
  ski,
}: {
  created: number
  updated: number
  completed: number
  stale: number
  escalations: number
  ski: number
}) {
  const badge = (label: string, value: number, tone: string) => (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', tone)}>
      {label}
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  )
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {badge('Создано 7д', created, 'border-border text-muted-foreground')}
      {badge('Обновлено 7д', updated, 'border-border text-muted-foreground')}
      {badge('Завершено 7д', completed, 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300')}
      {badge('Без апдейта 7д+', stale, 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300')}
      {badge('Эскалации', escalations, escalations > 0 ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300' : 'border-border text-muted-foreground')}
      {badge('СКИ', ski, ski > 0 ? 'border-indigo-300 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300' : 'border-border text-muted-foreground')}
    </div>
  )
}

/** Виджет «Мои задачи»: список личных задач с подсветкой по срочности. */
export function MyTasksCard({ tasks }: { tasks: ReportTaskSummary[] }) {
  return (
    <div className="max-h-64 space-y-2 overflow-auto">
      {tasks.length === 0 && <p className="text-sm text-muted-foreground">Личных задач нет.</p>}
      {tasks.map((task) => {
        const d = daysUntil(task.end_date)
        return (
          <Link
            key={task.id}
            to={`/projects/${task.project_id}?task=${task.id}`}
            className={cn('block rounded border px-2 py-1.5 text-xs transition-colors', myTaskUrgencyClass(d))}
          >
            <p className="truncate font-medium">{task.title}</p>
            <p className="text-muted-foreground">
              {TASK_STATUS_LABEL[task.status] ?? task.status} · {formatDate(task.end_date)}
              {d === null ? ' · без дедлайна' : d < 0 ? ' · просрочено' : ` · ${d} дн.`}
            </p>
          </Link>
        )
      })}
    </div>
  )
}

/** Список задач под контролем СКИ (внутри карточки «Мой фокус»). */
export function SkiControlList({ tasks }: { tasks: ReportTaskSummary[] }) {
  return (
    <div className="flex-1 min-h-0 space-y-1 overflow-auto pr-1">
      {tasks.length === 0 && <p className="text-[11px] text-muted-foreground">Нет активных задач СКИ</p>}
      {tasks.map((task) => {
        const d = daysUntil(task.end_date)
        return (
          <Link
            key={task.id}
            to={`/projects/${task.project_id}?task=${task.id}`}
            className={cn('block rounded border px-2 py-1 text-[11px] transition-colors', deadlinePulseClass(d) || 'hover:bg-accent')}
          >
            <p className="truncate font-medium">{task.title}</p>
            <p className="text-muted-foreground">
              {formatDate(task.end_date)}
              {d === null ? ' · без дедлайна' : d >= 0 ? ` · ${d} дн.` : ' · просрочено'}
            </p>
          </Link>
        )
      })}
    </div>
  )
}

/** Терминал-рендер системного лога (последние события). Модалка деталей — в Dashboard. */
export function SystemLogTerminal({ items }: { items: SystemActivityLog[] }) {
  return (
    <div className="h-64 overflow-auto rounded-lg border border-emerald-700/60 bg-black p-2 font-mono text-[11px] leading-relaxed text-emerald-400 shadow-[inset_0_0_24px_rgba(16,185,129,0.2)]">
      {items.length === 0 ? (
        <p className="text-emerald-500/80">[idle] Нет системных событий за 24 часа</p>
      ) : (
        <div className="space-y-1">
          {items.slice(0, 40).map((item) => (
            <p
              key={item.id}
              className={cn(
                'truncate',
                isDigestQueueLog(item) && 'rounded border border-cyan-400/60 bg-cyan-500/10 px-1 text-cyan-300'
              )}
            >
              [{new Date(item.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}] [{item.level}] {item.source}: {item.message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/** Виджет «Мудрость дня»: терминал-стайл цитата, обновляется каждые 15 мин и по клику.
 *  Инкапсулирует собственный стейт и интервал (раньше жили в Dashboard). */
export function WisdomCard() {
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * IT_QUOTES.length))
  const [updatedAt, setUpdatedAt] = useState(() => new Date())
  const quote = IT_QUOTES[quoteIndex] ?? IT_QUOTES[0]

  useEffect(() => {
    const tick = () => {
      setQuoteIndex(pickDifferentQuoteIndex)
      setUpdatedAt(new Date())
    }
    const intervalId = window.setInterval(tick, 15 * 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  return (
    <SectionCard title="Мудрость дня" className="xl:col-span-2">
      <button
        type="button"
        onClick={() => {
          setQuoteIndex(pickDifferentQuoteIndex)
          setUpdatedAt(new Date())
        }}
        className="flex h-64 w-full flex-col justify-start overflow-auto rounded-lg border border-emerald-700/60 bg-black p-2 text-left align-top font-mono text-[11px] leading-relaxed text-emerald-400 shadow-[inset_0_0_24px_rgba(16,185,129,0.2)]"
        title="Кликните для новой цитаты"
      >
        <div className="space-y-1">
          <p>[{updatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}] [wisdom_bot] quote_loaded</p>
          <p className="whitespace-pre-wrap text-base leading-7">“{quote}”</p>
          <p className="text-emerald-500/80">[info] Обновляется случайно каждые 15 минут + кликом по окну.</p>
        </div>
      </button>
    </SectionCard>
  )
}
