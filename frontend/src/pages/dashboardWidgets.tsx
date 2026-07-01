import { Link } from 'react-router-dom'
import type { ReportTaskSummary } from '@/types'
import { cn, daysUntil, myTaskUrgencyClass, deadlinePulseClass, TASK_STATUS_LABEL, formatDate } from './dashboardUtils'

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
