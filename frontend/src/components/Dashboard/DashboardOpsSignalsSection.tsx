import { Link } from 'react-router-dom'
import type { Project, Task } from '@/types'
import type { ReactNode } from 'react'

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function CardShell({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('h-full rounded-xl border bg-card p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  )
}

type DashboardOpsSignalsSectionProps = {
  tasksCount: number
  statusStats: Record<string, number>
  taskStatusLabel: Record<string, string>
  upcomingDeadlines: Task[]
  weekSignals: { created: number; updated: number; completed: number; stale: number }
  escalationsCount: number
  skiControlTasks: Task[]
  projectMap: Record<string, Project>
  daysUntil: (value?: string) => number | null
  formatDate: (value?: string) => string
  deadlinePulseClass: (days: number | null) => string
}

export function DashboardOpsSignalsSection({
  tasksCount,
  statusStats,
  taskStatusLabel,
  upcomingDeadlines,
  weekSignals,
  escalationsCount,
  skiControlTasks,
  projectMap,
  daysUntil,
  formatDate,
  deadlinePulseClass,
}: DashboardOpsSignalsSectionProps) {
  return (
    <>
      <CardShell title="Статусы и дедлайны" className="xl:col-span-3">
        <div className="space-y-3">
          {Object.entries(statusStats).map(([key, value]) => (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{taskStatusLabel[key]}</span>
                <span className="font-semibold tabular-nums">{value}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${tasksCount ? (value / tasksCount) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t pt-3">
          <p className="mb-2 text-xs text-muted-foreground">Ближайшие дедлайны</p>
          <div className="space-y-2">
            {upcomingDeadlines.length === 0 && <p className="text-xs text-muted-foreground">Нет предстоящих дедлайнов</p>}
            {upcomingDeadlines.map((task) => (
              <Link
                key={task.id}
                to={`/projects/${task.project_id}`}
                className={cn(
                  'block rounded border px-2 py-1.5 text-xs transition-colors',
                  deadlinePulseClass(daysUntil(task.end_date)) || 'hover:bg-accent'
                )}
              >
                <p className="truncate font-medium">{task.title}</p>
                <p className="text-muted-foreground">
                  {projectMap[task.project_id]?.name ?? 'Проект'} · {formatDate(task.end_date)}
                  {(() => {
                    const d = daysUntil(task.end_date)
                    if (d === null) return ''
                    return d >= 0 ? ` · ${d} дн.` : ' · просрочено'
                  })()}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </CardShell>

      <CardShell title="Сигналы контроля" className="xl:col-span-2 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded border p-2">
              <p className="text-[11px] text-muted-foreground">Создано 7д</p>
              <p className="text-lg font-semibold">{weekSignals.created}</p>
            </div>
            <div className="rounded border p-2">
              <p className="text-[11px] text-muted-foreground">Обновлено 7д</p>
              <p className="text-lg font-semibold">{weekSignals.updated}</p>
            </div>
            <div className="rounded border p-2">
              <p className="text-[11px] text-muted-foreground">Завершено 7д</p>
              <p className="text-lg font-semibold text-emerald-700">{weekSignals.completed}</p>
            </div>
            <div className="rounded border p-2">
              <p className="text-[11px] text-muted-foreground">Без апдейта 7д+</p>
              <p className="text-lg font-semibold text-amber-700">{weekSignals.stale}</p>
            </div>
          </div>
          <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded border p-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Эскалации на мне</span>
              <span className="font-semibold">{escalationsCount}</span>
            </div>
            <div className="mt-2 flex min-h-0 flex-1 flex-col border-t pt-2">
              <p className="mb-1 text-muted-foreground">СКИ контроль ({skiControlTasks.length})</p>
              <div className="flex-1 min-h-0 space-y-1 overflow-y-auto overflow-x-hidden pr-1">
                {skiControlTasks.length === 0 && <p className="text-[11px] text-muted-foreground">Нет активных задач СКИ</p>}
                {skiControlTasks.map((task) => {
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
            </div>
          </div>
        </div>
      </CardShell>
    </>
  )
}
