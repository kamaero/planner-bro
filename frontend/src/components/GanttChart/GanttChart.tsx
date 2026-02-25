import { Gantt, Task, ViewMode } from 'gantt-task-react'
import 'gantt-task-react/dist/index.css'
import type { GanttTask } from '@/types'
import { useState } from 'react'

const GANTT_TASK_LIMIT = 150

interface GanttChartProps {
  tasks: GanttTask[]
  onTaskClick?: (task: GanttTask) => void
}

function toGanttTasks(tasks: GanttTask[]): Task[] {
  return tasks.map((t) => ({
    id: t.id,
    name: t.name,
    start: new Date(t.start),
    end: new Date(t.end),
    progress: t.progress * 100,
    dependencies: t.dependencies,
    type: t.type as Task['type'],
    project: t.project,
    styles: t.color ? { progressColor: t.color, progressSelectedColor: t.color } : undefined,
  }))
}

export function GanttChart({ tasks, onTaskClick }: GanttChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week)

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        No tasks with dates to display in Gantt view.
      </div>
    )
  }

  const displayTasks = tasks.slice(0, GANTT_TASK_LIMIT)
  const ganttTasks = toGanttTasks(displayTasks)

  return (
    <div>
      {tasks.length > GANTT_TASK_LIMIT && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
          Показано {GANTT_TASK_LIMIT} из {tasks.length} задач с датами. Используйте фильтры в списке задач для детального просмотра.
        </div>
      )}
      <div className="flex gap-2 mb-3">
        {(['Day', 'Week', 'Month'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(ViewMode[mode])}
            className={`px-3 py-1 rounded text-sm ${
              viewMode === ViewMode[mode]
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>
      <Gantt
        tasks={ganttTasks}
        viewMode={viewMode}
        onSelect={(task) => {
          const original = tasks.find((t) => t.id === task.id)
          if (original && onTaskClick) onTaskClick(original)
        }}
        listCellWidth=""
        columnWidth={viewMode === ViewMode.Month ? 150 : 60}
      />
    </div>
  )
}
