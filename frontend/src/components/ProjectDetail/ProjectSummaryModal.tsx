import { BarChart2, X, AlertTriangle, CheckCircle2, Clock, Users } from 'lucide-react'

interface AssigneeRow {
  name: string
  count: number
}

interface DeadlineChangeRow {
  id: string
  old_date: string | null
  new_date: string | null
  reason: string
  created_at: string
  changed_by: string | null
}

interface TaskCounts {
  total: number
  done: number
  in_progress: number
  planning: number
  todo: number
  other: number
  overdue: number
}

export interface ProjectSummaryData {
  task_counts: TaskCounts
  avg_progress: number
  top_assignees: AssigneeRow[]
  deadline_changes: DeadlineChangeRow[]
  generated_at: string
}

interface Props {
  projectName: string
  data: ProjectSummaryData
  onClose: () => void
}

function StatBadge({ label, value, variant = 'default' }: { label: string; value: number; variant?: 'default' | 'success' | 'danger' | 'warn' }) {
  const colors = {
    default: 'bg-muted text-muted-foreground',
    success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    danger: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    warn: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  }
  return (
    <div className={`rounded-lg px-3 py-2 text-center ${colors[variant]}`}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs mt-0.5">{label}</div>
    </div>
  )
}

export function ProjectSummaryModal({ projectName, data, onClose }: Props) {
  const { task_counts: c, avg_progress, top_assignees, deadline_changes } = data

  const active = c.in_progress + c.todo + c.planning + c.other
  const donePercent = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" />
            <span className="font-semibold">Сводка: {projectName}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1 space-y-5">

          {/* Task counts grid */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Задачи
            </h3>
            <div className="grid grid-cols-4 gap-2">
              <StatBadge label="Всего" value={c.total} />
              <StatBadge label="Выполнено" value={c.done} variant="success" />
              <StatBadge label="В работе" value={active} />
              <StatBadge label="Просрочено" value={c.overdue} variant={c.overdue > 0 ? 'danger' : 'default'} />
            </div>
          </section>

          {/* Progress bar */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Прогресс
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all rounded-full"
                  style={{ width: `${avg_progress}%` }}
                />
              </div>
              <span className="text-sm font-semibold tabular-nums w-12 text-right">{avg_progress}%</span>
            </div>
            <div className="mt-1.5 flex gap-4 text-xs text-muted-foreground">
              <span>Завершено: {donePercent}% задач</span>
              <span>Средний прогресс: {avg_progress}%</span>
            </div>
          </section>

          {/* Top assignees */}
          {top_assignees.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Исполнители
              </h3>
              <div className="space-y-1.5">
                {top_assignees.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-5 text-xs text-muted-foreground text-right shrink-0">{i + 1}.</div>
                    <div className="flex-1 text-sm">{a.name}</div>
                    <div className="flex items-center gap-1.5">
                      <div
                        className="h-1.5 bg-primary/60 rounded-full"
                        style={{ width: `${Math.max(8, (a.count / (top_assignees[0]?.count || 1)) * 80)}px` }}
                      />
                      <span className="text-xs text-muted-foreground tabular-nums w-12">{a.count} зад.</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Deadline changes */}
          {deadline_changes.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Переносы дедлайна ({deadline_changes.length})
              </h3>
              <div className="space-y-2">
                {deadline_changes.map((dc) => (
                  <div key={dc.id} className="rounded border bg-muted/30 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between text-muted-foreground mb-0.5">
                      <span>{new Date(dc.created_at).toLocaleDateString('ru-RU')}{dc.changed_by ? ` · ${dc.changed_by}` : ''}</span>
                      <span className="font-medium">
                        {dc.old_date ? new Date(dc.old_date).toLocaleDateString('ru-RU') : '—'} →{' '}
                        {dc.new_date ? new Date(dc.new_date).toLocaleDateString('ru-RU') : '—'}
                      </span>
                    </div>
                    <p className="italic text-foreground">"{dc.reason}"</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {deadline_changes.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Переносов дедлайна проекта не было.</p>
          )}
        </div>

        <div className="px-5 py-3 border-t text-xs text-muted-foreground">
          Данные на: {new Date(data.generated_at).toLocaleDateString('ru-RU')}
        </div>
      </div>
    </div>
  )
}
