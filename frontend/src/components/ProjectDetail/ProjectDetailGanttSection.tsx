import { GanttChart } from '@/components/GanttChart/GanttChart'
import type { GanttTask, CriticalPathResponse } from '@/types'

interface Props {
  ganttTasks: GanttTask[]
  criticalPath: CriticalPathResponse | undefined
  onTaskClick: (task: GanttTask) => void
}

export function ProjectDetailGanttSection({ ganttTasks, criticalPath, onTaskClick }: Props) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-4 overflow-x-auto">
        <GanttChart
          tasks={ganttTasks}
          onTaskClick={onTaskClick}
        />
      </div>
      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm font-semibold mb-2">Critical Path</p>
        {!criticalPath || criticalPath.task_ids.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет зависимостей для расчёта.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {criticalPath.tasks.map((t) => (
              <span key={t.id} className="text-xs px-2 py-1 rounded border bg-background">
                {t.title}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
