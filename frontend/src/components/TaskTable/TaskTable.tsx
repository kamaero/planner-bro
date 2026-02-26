import { useEffect, useRef } from 'react'
import type { Task } from '@/types'
import { Clock, AlertCircle } from 'lucide-react'

const STATUS_LABELS: Record<string, string> = {
  planning: 'Планирование',
  todo: 'К выполнению',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Выполнено',
}

const STATUS_BADGE: Record<string, string> = {
  planning: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  todo: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}

const PRIORITY_BADGE: Record<string, string> = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
}

interface TaskTableProps {
  tasks: Task[]
  onTaskClick: (task: Task) => void
  onStatusChange?: (taskId: string, status: string) => void
  shiftsMap?: Record<string, number>
  rowSize?: 'compact' | 'normal' | 'comfortable'
}

export function TaskTable({
  tasks,
  onTaskClick,
  onStatusChange,
  shiftsMap = {},
  rowSize = 'normal',
}: TaskTableProps) {
  const today = new Date().toISOString().slice(0, 10)
  const topRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const syncingRef = useRef<'top' | 'bottom' | null>(null)

  useEffect(() => {
    const top = topRef.current
    const bottom = bottomRef.current
    if (!top || !bottom) return
    const handleTop = () => {
      if (syncingRef.current === 'bottom') return
      syncingRef.current = 'top'
      bottom.scrollLeft = top.scrollLeft
      syncingRef.current = null
    }
    const handleBottom = () => {
      if (syncingRef.current === 'top') return
      syncingRef.current = 'bottom'
      top.scrollLeft = bottom.scrollLeft
      syncingRef.current = null
    }
    top.addEventListener('scroll', handleTop)
    bottom.addEventListener('scroll', handleBottom)
    return () => {
      top.removeEventListener('scroll', handleTop)
      bottom.removeEventListener('scroll', handleBottom)
    }
  }, [])

  const pyClass = rowSize === 'compact' ? 'py-1.5' : rowSize === 'comfortable' ? 'py-3.5' : 'py-2.5'
  const commentClamp = rowSize === 'compact' ? 'line-clamp-1' : 'line-clamp-2'

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Задач нет. Создайте первую задачу.
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <div ref={topRef} className="overflow-x-auto border-b bg-muted/20">
        <div className="h-3 min-w-[1220px]" />
      </div>
      <div ref={bottomRef} className="overflow-x-auto">
      <table className="w-full text-sm min-w-[1220px]">
        <thead>
          <tr className="border-b bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
            <th className="px-4 py-2.5 text-left font-medium min-w-[340px]">Задача</th>
            <th className="px-3 py-2.5 text-left font-medium min-w-[280px]">Комментарий</th>
            <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Статус</th>
            <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Приоритет</th>
            <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Исполнитель</th>
            <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Дедлайн</th>
            <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Прогресс</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tasks.map((task) => {
            const isOverdue = task.end_date && task.end_date < today && task.status !== 'done'
            const shiftCount = shiftsMap[task.id] ?? 0

            return (
              <tr
                key={task.id}
                className="hover:bg-muted/30 cursor-pointer transition-colors group"
                onClick={() => onTaskClick(task)}
              >
                {/* Title */}
                <td className={`px-4 ${pyClass}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0">
                      <p className="font-medium whitespace-normal break-words group-hover:text-primary transition-colors">
                        {task.title}
                      </p>
                      {task.next_step && (
                        <p className={`text-xs text-muted-foreground mt-0.5 ${commentClamp}`}>
                          → {task.next_step}
                        </p>
                      )}
                    </div>
                    {shiftCount > 0 && (
                      <span
                        title={`Дедлайн переносился ${shiftCount} раз`}
                        className="shrink-0 text-amber-500 mt-0.5"
                      >
                        <AlertCircle className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                </td>
                <td className={`px-3 ${pyClass}`}>
                  {task.last_comment ? (
                    <p className={`text-xs text-muted-foreground whitespace-normal break-words ${commentClamp}`}>
                      {task.last_comment}
                    </p>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>

                {/* Status */}
                <td className={`px-3 ${pyClass}`} onClick={(e) => e.stopPropagation()}>
                  {onStatusChange ? (
                    <select
                      value={task.status}
                      onChange={(e) => onStatusChange(task.id, e.target.value)}
                      className={`text-xs font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer ${STATUS_BADGE[task.status]}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {Object.entries(STATUS_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[task.status]}`}>
                      {STATUS_LABELS[task.status] ?? task.status}
                    </span>
                  )}
                </td>

                {/* Priority */}
                <td className={`px-3 ${pyClass}`}>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_BADGE[task.priority] ?? ''}`}>
                    {task.control_ski ? 'СКИ' : (PRIORITY_LABELS[task.priority] ?? task.priority)}
                  </span>
                </td>

                {/* Assignee */}
                <td className={`px-3 ${pyClass}`}>
                  {task.assignees && task.assignees.length > 0 ? (
                    <span className={`text-sm ${commentClamp} whitespace-normal break-words block`}>
                      {task.assignees.map((u) => u.name).join(', ')}
                    </span>
                  ) : task.assignee ? (
                    <span className="text-sm">{task.assignee.name}</span>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>

                {/* Deadline */}
                <td className={`px-3 ${pyClass} whitespace-nowrap`}>
                  {task.end_date ? (
                    <div className="flex items-center gap-1">
                      {isOverdue && <Clock className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                      <span className={isOverdue ? 'text-red-600 font-medium' : shiftCount > 0 ? 'text-amber-600' : ''}>
                        {new Date(task.end_date).toLocaleDateString('ru-RU', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>

                {/* Progress */}
                <td className={`px-3 ${pyClass}`}>
                  <div className="flex items-center gap-2 min-w-[80px]">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          task.status === 'done'
                            ? 'bg-emerald-500'
                            : task.progress_percent >= 75
                            ? 'bg-indigo-500'
                            : task.progress_percent >= 40
                            ? 'bg-amber-500'
                            : 'bg-slate-400'
                        }`}
                        style={{ width: `${task.progress_percent}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums w-7 text-right">
                      {task.progress_percent}%
                    </span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}
