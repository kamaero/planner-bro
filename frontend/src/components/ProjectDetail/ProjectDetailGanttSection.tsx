import { GanttChart } from '@/components/GanttChart/GanttChart'
import type { CriticalPathResponse, GanttTask } from '@/types'

type ProjectDetailGanttSectionProps = {
  tasks: GanttTask[]
  criticalPath?: CriticalPathResponse
  onTaskClick: (task: GanttTask) => void
  isLoading?: boolean
}

export function ProjectDetailGanttSection({
  tasks,
  criticalPath,
  onTaskClick,
  isLoading,
}: ProjectDetailGanttSectionProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-4 overflow-x-auto">
        <GanttChart tasks={tasks} onTaskClick={onTaskClick} isLoading={isLoading} />
      </div>
      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm font-semibold mb-2">Critical Path</p>
        {!criticalPath || criticalPath.task_ids.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет зависимостей для расчёта.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {criticalPath.tasks.map((task) => (
              <span key={task.id} className="text-xs px-2 py-1 rounded border bg-background">
                {task.title}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
