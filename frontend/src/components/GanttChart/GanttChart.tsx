import { Gantt, Task, ViewMode } from 'gantt-task-react'
import 'gantt-task-react/dist/index.css'
import type { GanttTask } from '@/types'
import { useEffect, useMemo, useRef, useState } from 'react'

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
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Нет задач с датами для отображения на диаграмме Ганта.
      </div>
    )
  }

  const displayTasks = tasks.slice(0, GANTT_TASK_LIMIT)
  const ganttTasks = toGanttTasks(displayTasks)
  const timeColumnCount = useMemo(() => {
    if (ganttTasks.length === 0) return 1
    const starts = ganttTasks.map((t) => t.start.getTime())
    const ends = ganttTasks.map((t) => t.end.getTime())
    const minStart = new Date(Math.min(...starts))
    const maxEnd = new Date(Math.max(...ends))

    const dayMs = 24 * 60 * 60 * 1000
    const daySpan = Math.max(1, Math.ceil((maxEnd.getTime() - minStart.getTime()) / dayMs) + 1)
    if (viewMode === ViewMode.Day) return daySpan
    if (viewMode === ViewMode.Week) return Math.max(1, Math.ceil(daySpan / 7))
    return (
      (maxEnd.getFullYear() - minStart.getFullYear()) * 12 +
      (maxEnd.getMonth() - minStart.getMonth()) +
      1
    )
  }, [ganttTasks, viewMode])

  const columnWidth = useMemo(() => {
    if (!containerWidth || !timeColumnCount) {
      return viewMode === ViewMode.Month ? 150 : 60
    }
    const minWidth = viewMode === ViewMode.Day ? 42 : viewMode === ViewMode.Week ? 90 : 140
    const maxWidth = viewMode === ViewMode.Day ? 90 : viewMode === ViewMode.Week ? 260 : 300
    const adaptive = Math.floor(containerWidth / timeColumnCount)
    return Math.min(maxWidth, Math.max(minWidth, adaptive))
  }, [containerWidth, timeColumnCount, viewMode])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.floor(entries[0]?.contentRect.width ?? 0)
      setContainerWidth(nextWidth)
    })
    observer.observe(el)
    setContainerWidth(Math.floor(el.getBoundingClientRect().width))

    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef}>
      {tasks.length > GANTT_TASK_LIMIT && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
          Показано {GANTT_TASK_LIMIT} из {tasks.length} задач с датами. Используйте фильтры в списке задач для детального просмотра.
        </div>
      )}
      <div className="flex gap-2 mb-3">
        {([
          { key: 'Day', label: 'День' },
          { key: 'Week', label: 'Неделя' },
          { key: 'Month', label: 'Месяц' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setViewMode(ViewMode[key])}
            className={`px-3 py-1 rounded text-sm ${
              viewMode === ViewMode[key]
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <Gantt
        tasks={ganttTasks}
        viewMode={viewMode}
        locale="ru"
        onSelect={(task) => {
          const original = tasks.find((t) => t.id === task.id)
          if (original && onTaskClick) onTaskClick(original)
        }}
        listCellWidth=""
        columnWidth={columnWidth}
      />
    </div>
  )
}
