import { useProjectTimeSummary } from '@/hooks/useProjects'
import { Clock } from 'lucide-react'

const STATUS_LABEL: Record<string, string> = {
  done:        'Готово',
  in_progress: 'В работе',
  testing:     'Тест',
  tz:          'ТЗ',
  on_hold:     'Пауза',
  planning:    'Планир.',
  todo:        'К выполнению',
  review:      'Ревью',
}

interface Props {
  projectId: string
}

export function TimeTrackingPanel({ projectId }: Props) {
  const { data: summary, isLoading } = useProjectTimeSummary(projectId)

  if (isLoading) {
    return <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Загрузка...</div>
  }

  if (!summary) return null

  const hasAnyData = summary.tasks_with_estimate > 0 || summary.tasks_with_actual > 0

  const coverage = summary.total_tasks > 0
    ? Math.round((summary.tasks_with_estimate / summary.total_tasks) * 100)
    : 0

  const overrun = summary.total_estimated && summary.total_actual
    ? summary.total_actual > summary.total_estimated
    : false

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Всего задач</p>
          <p className="text-2xl font-semibold mt-1">{summary.total_tasks}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">План (ч)</p>
          <p className="text-2xl font-semibold mt-1">
            {summary.total_estimated != null ? summary.total_estimated : '—'}
          </p>
          <p className="text-xs text-muted-foreground">{coverage}% задач с оценкой</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Факт (ч)</p>
          <p className={`text-2xl font-semibold mt-1 ${overrun ? 'text-red-500' : ''}`}>
            {summary.total_actual != null ? summary.total_actual : '—'}
          </p>
          <p className="text-xs text-muted-foreground">{summary.tasks_with_actual} задач с фактом</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Отклонение</p>
          {summary.total_estimated && summary.total_actual ? (
            <>
              <p className={`text-2xl font-semibold mt-1 ${overrun ? 'text-red-500' : 'text-green-600'}`}>
                {overrun ? '+' : ''}{Math.round(summary.total_actual - summary.total_estimated)}ч
              </p>
              <p className="text-xs text-muted-foreground">
                {Math.round((summary.total_actual / summary.total_estimated) * 100)}% от плана
              </p>
            </>
          ) : (
            <p className="text-2xl font-semibold mt-1 text-muted-foreground">—</p>
          )}
        </div>
      </div>

      {!hasAnyData && (
        <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Ни у одной задачи пока не заполнены часы. Откройте задачу и укажите плановые и фактические часы.
        </div>
      )}

      {hasAnyData && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* By assignee */}
          {summary.by_assignee.length > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <p className="text-sm font-semibold mb-3">По исполнителям</p>
              <div className="space-y-3">
                {summary.by_assignee.map((row) => {
                  const key = row.assignee_id ?? 'unassigned'
                  const pct = row.estimated > 0 ? Math.round((row.actual / row.estimated) * 100) : null
                  const over = pct != null && pct > 100
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium truncate max-w-[160px]">
                          {row.assignee_name ?? 'Без исполнителя'}
                        </span>
                        <span className="text-muted-foreground shrink-0 ml-2">
                          {row.estimated > 0 ? `${row.actual}/${row.estimated}ч` : `${row.actual}ч`}
                          {pct != null && (
                            <span className={`ml-1 font-semibold ${over ? 'text-red-500' : 'text-green-600'}`}>
                              ({pct}%)
                            </span>
                          )}
                        </span>
                      </div>
                      {row.estimated > 0 && (
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${over ? 'bg-red-400' : 'bg-primary'}`}
                            style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
                          />
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">{row.task_count} задач</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* By status */}
          {summary.by_status.length > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <p className="text-sm font-semibold mb-3">По статусам</p>
              <div className="space-y-2">
                {summary.by_status.map((row) => (
                  <div key={row.status} className="flex justify-between text-xs items-center">
                    <span className="text-muted-foreground w-24 shrink-0">
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                    <div className="flex-1 mx-3">
                      {row.estimated > 0 && (
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/60"
                            style={{ width: `${Math.min((row.actual / row.estimated) * 100, 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <span className="font-medium shrink-0">
                      {row.estimated > 0 ? `${row.actual}/${row.estimated}ч` : `${row.actual}ч факт`}
                    </span>
                    <span className="text-muted-foreground ml-2 shrink-0">({row.task_count})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
