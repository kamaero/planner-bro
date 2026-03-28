import { useEffect, useRef } from 'react'
import type { Task } from '@/types'
import { Clock, AlertCircle, CornerDownRight, ChevronRight, ChevronDown, GripVertical } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ExternalDep } from '@/hooks/useProjects'
import { buildTaskNumbering, stripTaskOrderPrefix } from '@/lib/taskOrdering'
import { formatUserDisplayName } from '@/lib/userName'

const STATUS_LABELS: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  todo: 'К выполнению',
  in_progress: 'В работе',
  testing: 'Тестирование',
  review: 'На проверке',
  done: 'Выполнено',
}

const STATUS_BADGE: Record<string, string> = {
  planning: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  tz: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  todo: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  testing: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
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

const EXT_STATUS_COLORS: Record<string, string> = {
  waiting:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  testing:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  received: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  overdue:  'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

const EXT_STATUS_LABELS: Record<string, string> = {
  waiting: 'Ждём', testing: 'Тест', received: 'Получено', overdue: 'Просрочено',
}

interface TaskTableProps {
  tasks: Task[]
  allTasks?: Task[]
  onTaskClick: (task: Task) => void
  onStatusChange?: (taskId: string, status: string) => void
  shiftsMap?: Record<string, number>
  rowSize?: 'compact' | 'normal' | 'comfortable'
  externalDepsMap?: Record<string, ExternalDep[]>
  isFetching?: boolean
  hasChildrenIds?: Set<string>
  collapsedTaskIds?: Set<string>
  onToggleCollapse?: (taskId: string) => void
  onReorder?: (fromIndex: number, toIndex: number) => void
}

function SortableRow({
  task,
  isDraggable,
  onClick,
  children,
}: {
  task: Task
  isDraggable: boolean
  onClick: () => void
  children: (dragHandleProps: React.HTMLAttributes<HTMLElement> | null, isDragging: boolean) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 1 : undefined,
  }
  return (
    <tr
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className="hover:bg-muted/30 cursor-pointer transition-colors group"
    >
      {children(isDraggable ? { ...attributes, ...listeners } : null, isDragging)}
    </tr>
  )
}

export function TaskTable({
  tasks,
  allTasks,
  onTaskClick,
  onStatusChange,
  shiftsMap = {},
  rowSize = 'normal',
  externalDepsMap = {},
  isFetching = false,
  hasChildrenIds,
  collapsedTaskIds,
  onToggleCollapse,
  onReorder,
}: TaskTableProps) {
  const today = new Date().toISOString().slice(0, 10)
  const isDraggable = Boolean(onReorder)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !onReorder) return
    const fromIndex = tasks.findIndex((t) => t.id === active.id)
    const toIndex = tasks.findIndex((t) => t.id === over.id)
    if (fromIndex !== -1 && toIndex !== -1) onReorder(fromIndex, toIndex)
  }

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
  const sourceTasks = allTasks && allTasks.length > 0 ? allTasks : tasks
  const taskById = new Map(sourceTasks.map((task) => [task.id, task]))
  const numberingById = buildTaskNumbering(sourceTasks)
  const depthById = new Map<string, number>()
  const computeDepth = (taskId: string): number => {
    if (depthById.has(taskId)) return depthById.get(taskId) ?? 0
    let depth = 0
    const visited = new Set<string>([taskId])
    let cursor = taskById.get(taskId)?.parent_task_id
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor)
      depth += 1
      cursor = taskById.get(cursor)?.parent_task_id
    }
    const capped = Math.max(0, Math.min(6, depth))
    depthById.set(taskId, capped)
    return capped
  }

  if (tasks.length === 0 && !isFetching) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Задач нет. Создайте первую задачу.
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <div className="px-4 py-2.5 border-b bg-muted/20 text-xs text-muted-foreground flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <CornerDownRight className="w-3.5 h-3.5" />
          Структура (parent-child)
        </span>
        <span className="text-muted-foreground/60">|</span>
        <span className="inline-flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
          Блокировка старта (dependency)
        </span>
        <span className="text-muted-foreground/60">|</span>
        <span>Назначение parent-child: откройте задачу и выберите «Родительская задача (структура)»</span>
      </div>
      <div ref={topRef} className="overflow-x-auto border-b bg-muted/20">
        <div className="h-3 min-w-[1220px]" />
      </div>
      <div ref={bottomRef} className="overflow-x-auto">
      <table className="w-full text-sm min-w-[1220px]">
        <thead>
          <tr className="border-b bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
            {isDraggable && <th className="pl-2 pr-0 w-6 py-2.5" />}
            <th className="px-4 py-2.5 text-left font-medium min-w-[340px]">Задача</th>
            <th className="px-3 py-2.5 text-left font-medium min-w-[280px]">Комментарий</th>
            <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Статус</th>
            <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Приоритет</th>
            <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Исполнитель</th>
            <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Дедлайн</th>
            <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Прогресс</th>
            <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Подрядчики</th>
          </tr>
        </thead>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <tbody className="divide-y divide-border">
          {tasks.map((task) => {
            const isOverdue = task.end_date && task.end_date < today && task.status !== 'done'
            const shiftCount = shiftsMap[task.id] ?? 0
            const depth = computeDepth(task.id)
            const hasParent = Boolean(task.parent_task_id)
            const predecessorIds = task.predecessor_ids ?? []
            const hasBlockingDependency = predecessorIds.length > 0
            const parentTitle = task.parent_task_id ? stripTaskOrderPrefix(taskById.get(task.parent_task_id)?.title ?? '') || null : null
            const predecessorTitles = predecessorIds
              .map((id) => stripTaskOrderPrefix(taskById.get(id)?.title || '') || id)
              .slice(0, 2)

            const isParentTask = hasChildrenIds?.has(task.id) ?? false
            const isCollapsed = collapsedTaskIds?.has(task.id) ?? false

            return (
              <SortableRow key={task.id} task={task} isDraggable={isDraggable} onClick={() => onTaskClick(task)}>
                {(dragHandleProps) => (<>
                {/* Drag handle */}
                {isDraggable && (
                  <td className="pl-2 pr-0 w-6" onClick={(e) => e.stopPropagation()}>
                    <span
                      {...(dragHandleProps ?? {})}
                      className="flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
                      style={{ touchAction: 'none' }}
                    >
                      <GripVertical className="w-4 h-4" />
                    </span>
                  </td>
                )}
                {/* Title */}
                <td className={`px-4 ${pyClass}`}>
                  <div className="flex items-start gap-2" style={{ paddingLeft: `${depth * 24}px` }}>
                    {isParentTask ? (
                      <button
                        className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(task.id) }}
                        title={isCollapsed ? 'Развернуть подзадачи' : 'Свернуть подзадачи'}
                      >
                        {isCollapsed
                          ? <ChevronRight className="w-3.5 h-3.5" />
                          : <ChevronDown className="w-3.5 h-3.5" />
                        }
                      </button>
                    ) : hasParent ? (
                      <span className="mt-0.5 shrink-0 text-muted-foreground/80" title="Вложенная задача в структуре">
                        <CornerDownRight className="w-3.5 h-3.5" />
                      </span>
                    ) : (
                      <span className="mt-0.5 w-3.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-[10px] text-muted-foreground font-medium mb-0.5">
                        {numberingById.get(task.id) ?? '—'}
                      </div>
                      <p className="font-medium whitespace-normal break-words group-hover:text-primary transition-colors">
                        {stripTaskOrderPrefix(task.title)}
                      </p>
                      {hasBlockingDependency && (
                        <div className="mt-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                            зависимость
                          </span>
                        </div>
                      )}
                      {hasParent && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          ↳ Родитель: {parentTitle ?? task.parent_task_id}
                        </p>
                      )}
                      {hasBlockingDependency && (
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          ⛓ Зависит от: {predecessorTitles.join(', ')}
                          {predecessorIds.length > predecessorTitles.length ? ' …' : ''}
                        </p>
                      )}
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
                      {task.assignees.map((u) => formatUserDisplayName(u)).join(', ')}
                    </span>
                  ) : task.assignee ? (
                    <span className="text-sm">{formatUserDisplayName(task.assignee)}</span>
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
                          year: 'numeric',
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

                {/* External contractors */}
                <td className={`px-3 ${pyClass}`}>
                  <div className="flex flex-wrap gap-1 min-w-[120px]">
                    {(externalDepsMap[task.id] ?? []).map((dep) => (
                      <span
                        key={dep.id}
                        className={`text-xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${EXT_STATUS_COLORS[dep.status] ?? EXT_STATUS_COLORS.waiting}`}
                        title={`${dep.contractor_name} — ${EXT_STATUS_LABELS[dep.status] ?? dep.status}${dep.due_date ? ` (до ${dep.due_date})` : ''}`}
                      >
                        {dep.contractor_name}
                      </span>
                    ))}
                  </div>
                </td>
                </>)}
              </SortableRow>
            )
          })}
        </tbody>
        </SortableContext>
        </DndContext>
      </table>
      </div>
    </div>
  )
}
