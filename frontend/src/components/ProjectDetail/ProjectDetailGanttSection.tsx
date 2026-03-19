import { GanttChart } from '@/components/GanttChart/GanttChart'
import type { GanttTask } from '@/types'

type CriticalPathItem = {
  id: string
  title: string
  status: string
  end_date?: string | null
}

type CriticalPathData = {
  task_ids: string[]
  tasks: CriticalPathItem[]
}

type ProjectDetailGanttSectionProps = {
  tasks: GanttTask[]
  criticalPath?: CriticalPathData
  onTaskClick: (task: GanttTask) => void
}

export function ProjectDetailGanttSection({
  tasks,
  criticalPath,
  onTaskClick,
}: ProjectDetailGanttSectionProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-4 overflow-x-auto">
        <GanttChart tasks={tasks} onTaskClick={onTaskClick} />
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
