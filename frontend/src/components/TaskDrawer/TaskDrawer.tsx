import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  useUpdateTaskStatus,
  useDeleteTask,
  useUpdateTask,
  useTaskCheckIn,
  useTasks,
  useTaskDependencies,
  useAddTaskDependency,
  useRemoveTaskDependency,
  useTaskComments,
  useAddTaskComment,
  useTaskEvents,
  useTaskDeadlineHistory,
} from '@/hooks/useProjects'
import { useUsers } from '@/hooks/useUsers'
import { useMembers } from '@/hooks/useMembers'
import { CustomFieldsPanel } from '@/components/CustomFieldsPanel'
import { ExternalDepsPanel } from '@/components/ExternalDepsPanel'
import type { Task } from '@/types'
import { CalendarDays, Clock, User, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { DeadlineReasonModal } from '@/components/DeadlineReasonModal/DeadlineReasonModal'
import { humanizeApiError } from '@/lib/errorMessages'
import { buildTaskHierarchy, buildTaskNumbering } from '@/lib/taskOrdering'
import { formatUserDisplayName } from '@/lib/userName'
import { useAuthStore } from '@/store/authStore'
import { TaskCombobox } from './TaskCombobox'

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

const STATUS_OPTIONS = ['planning', 'tz', 'todo', 'in_progress', 'testing', 'review', 'done'] as const
const DEPENDENCY_TYPE_LABELS: Record<string, string> = {
  finish_to_start: 'FS (Окончание-Начало)',
  start_to_start: 'SS (Начало-Начало)',
  finish_to_finish: 'FF (Окончание-Окончание)',
}
const STATUS_LABELS: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  todo: 'К выполнению',
  in_progress: 'В работе',
  testing: 'Тестирование',
  review: 'На проверке',
  done: 'Выполнено',
}

function formatTaskEvent(eventType: string, payload?: string | null) {
  if (eventType === 'task_created') return 'Задача создана'
  if (eventType === 'task_deleted') return 'Задача удалена'
  if (eventType === 'task_imported_from_ms_project') return 'Импортировано из MS Project'
  if (eventType === 'task_created_from_ai_draft') return 'Создано из AI-черновика'
  if (eventType === 'task_created_from_recurrence') return 'Создано повторение задачи'
  if (eventType === 'comment_added') return 'Добавлен комментарий'
  if (eventType === 'escalation_first_response') return 'Отмечена первая реакция по эскалации'
  if (eventType === 'check_in_recorded') return 'Выполнен check-in'

  if (eventType === 'status_changed') {
    if (!payload) return 'Статус обновлен'
    const [from, to] = payload.split('->')
    if (!to) return `Статус: ${payload}`
    return `Статус: ${STATUS_LABELS[from] ?? from} → ${STATUS_LABELS[to] ?? to}`
  }
  if (eventType === 'progress_updated') return `Прогресс: ${payload ?? ''}%`
  if (eventType === 'next_step_updated') return `Следующий шаг: ${payload || '—'}`
  if (eventType === 'assignee_changed') {
    if (!payload) return 'Исполнитель изменен'
    return `Изменен исполнитель (${payload})`
  }
  if (eventType === 'date_changed') {
    if (!payload) return 'Дата изменена'
    const colonIdx = payload.indexOf(':')
    if (colonIdx === -1) return `Дата изменена: ${payload}`
    const field = payload.slice(0, colonIdx)
    const change = payload.slice(colonIdx + 1)
    const arrowIdx = change.indexOf('->')
    const from = arrowIdx === -1 ? change : change.slice(0, arrowIdx)
    const to = arrowIdx === -1 ? '' : change.slice(arrowIdx + 2)
    const label = field === 'end' ? 'Дедлайн' : 'Дата начала'
    return `${label}: ${from || '—'} → ${to || '—'}`
  }

  return payload ? `${eventType} (${payload})` : eventType
}

interface TaskDrawerProps {
  task: Task | null
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

export function TaskDrawer({ task, open, onOpenChange, projectId }: TaskDrawerProps) {
  const currentUser = useAuthStore((s) => s.user)
  const updateStatus = useUpdateTaskStatus()
  const deleteTask = useDeleteTask()
  const updateTask = useUpdateTask()
  const checkInTask = useTaskCheckIn()
  const { data: projectTasks = [] } = useTasks(projectId)
  const { data: members = [] } = useMembers(projectId)
  const { data: dependencies = [] } = useTaskDependencies(task?.id)
  const addDependency = useAddTaskDependency()
  const removeDependency = useRemoveTaskDependency()
  const addComment = useAddTaskComment()
  const { data: users = [] } = useUsers()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [status, setStatus] = useState('todo')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [controlSki, setControlSki] = useState(false)
  const [progressPercent, setProgressPercent] = useState('0')
  const [nextStep, setNextStep] = useState('')
  const [repeatDays, setRepeatDays] = useState('')
  const [isEscalation, setIsEscalation] = useState(false)
  const [escalationFor, setEscalationFor] = useState('')
  const [escalationSlaHours, setEscalationSlaHours] = useState('24')
  const [commentBody, setCommentBody] = useState('')
  const [showDeadlineReasonModal, setShowDeadlineReasonModal] = useState(false)
  const [pendingEndDate, setPendingEndDate] = useState('')
  const [showDeadlineHistory, setShowDeadlineHistory] = useState(false)
  const [checkInSummary, setCheckInSummary] = useState('')
  const [checkInBlockers, setCheckInBlockers] = useState('')
  const [checkInNextDueDate, setCheckInNextDueDate] = useState('')
  const [needManagerHelp, setNeedManagerHelp] = useState(false)
  const [newDependencyTaskId, setNewDependencyTaskId] = useState('')
  const [newDependencyType, setNewDependencyType] = useState<'finish_to_start' | 'start_to_start' | 'finish_to_finish'>('finish_to_start')
  const [newDependencyLagDays, setNewDependencyLagDays] = useState('0')
  const [selectedParentTaskId, setSelectedParentTaskId] = useState('')
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([])
  const [estimatedHours, setEstimatedHours] = useState('')
  const [actualHours, setActualHours] = useState('')

  const { data: comments = [] } = useTaskComments(task?.id)
  const { data: events = [] } = useTaskEvents(task?.id)
  const { data: deadlineHistory = [] } = useTaskDeadlineHistory(task?.id)
  const canAssignAcrossOrg = useMemo(() => {
    const position = (currentUser?.position_title ?? '').toLowerCase()
    const isGlobalPosition =
      position.includes('гип') ||
      position.includes('главный инженер проектов') ||
      position.includes('зам') ||
      position.includes('заместитель')
    return (
      currentUser?.role === 'admin' ||
      currentUser?.role === 'manager' ||
      !!currentUser?.can_manage_team ||
      isGlobalPosition
    )
  }, [currentUser?.can_manage_team, currentUser?.position_title, currentUser?.role])
  const assigneeOptions = useMemo(() => {
    const baseUsers =
      canAssignAcrossOrg || members.length === 0
        ? users
        : members.map((member) => member.user)
    const uniqueUsers = new Map<string, (typeof baseUsers)[number]>()
    for (const user of baseUsers) uniqueUsers.set(user.id, user)
    for (const user of task?.assignees ?? []) uniqueUsers.set(user.id, user)
    if (task?.assignee) uniqueUsers.set(task.assignee.id, task.assignee)
    return Array.from(uniqueUsers.values())
  }, [canAssignAcrossOrg, members, task?.assignee, task?.assignees, users])
  const blockedParentIds = useMemo(() => {
    if (!task?.id) return new Set<string>()
    const childrenByParent = new Map<string, string[]>()
    for (const projectTask of projectTasks) {
      if (!projectTask.parent_task_id) continue
      const items = childrenByParent.get(projectTask.parent_task_id) ?? []
      items.push(projectTask.id)
      childrenByParent.set(projectTask.parent_task_id, items)
    }
    const blocked = new Set<string>([task.id])
    const stack = [task.id]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue
      const children = childrenByParent.get(current) ?? []
      for (const childId of children) {
        if (blocked.has(childId)) continue
        blocked.add(childId)
        stack.push(childId)
      }
    }
    return blocked
  }, [projectTasks, task?.id])
  const taskHierarchyOptions = useMemo(() => buildTaskHierarchy(projectTasks), [projectTasks])
  const taskNumbering = useMemo(() => buildTaskNumbering(projectTasks), [projectTasks])

  useEffect(() => {
    if (!task) return
    setStartDate(task.start_date ?? '')
    setEndDate(task.end_date ?? '')
    setStatus(task.status)
    setPriority(task.priority)
    setControlSki(!!task.control_ski)
    setProgressPercent(String(task.progress_percent ?? 0))
    setNextStep(task.next_step ?? '')
    setRepeatDays(task.repeat_every_days ? String(task.repeat_every_days) : '')
    setEstimatedHours(task.estimated_hours != null ? String(task.estimated_hours) : '')
    setActualHours(task.actual_hours != null ? String(task.actual_hours) : '')
    setIsEscalation(!!task.is_escalation)
    setEscalationFor(task.escalation_for ?? '')
    setEscalationSlaHours(String(task.escalation_sla_hours ?? 24))
    setCheckInSummary('')
    setCheckInBlockers('')
    setCheckInNextDueDate(
      task.next_check_in_due_at ? new Date(task.next_check_in_due_at).toISOString().slice(0, 16) : ''
    )
    setNeedManagerHelp(false)
    setNewDependencyTaskId('')
    setNewDependencyType('finish_to_start')
    setNewDependencyLagDays('0')
    setSelectedParentTaskId(task.parent_task_id ?? '')
    setSelectedAssigneeIds(task.assignee_ids && task.assignee_ids.length > 0
      ? task.assignee_ids
      : task.assigned_to_id
        ? [task.assigned_to_id]
        : [])
  }, [task])

  if (!task) return null

  const handlePriorityChange = async (nextPriority: string) => {
    const p = nextPriority as 'low' | 'medium' | 'high' | 'critical'
    setPriority(p)
    try {
      await updateTask.mutateAsync({
        taskId: task.id,
        data: {
          priority: controlSki ? 'critical' : p,
          control_ski: controlSki,
        },
      })
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось обновить приоритет задачи'))
    }
  }

  const handleControlSkiChange = async (checked: boolean) => {
    const nextControl = checked
    const nextPriority = nextControl ? 'critical' : priority === 'critical' ? 'medium' : priority
    setControlSki(nextControl)
    setPriority(nextPriority)
    try {
      await updateTask.mutateAsync({
        taskId: task.id,
        data: {
          control_ski: nextControl,
          priority: nextControl ? 'critical' : nextPriority,
        },
      })
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось обновить флаг контроля СКИ'))
    }
  }

  const handleStatusSave = async (): Promise<boolean> => {
    const parsed = Number.parseInt(progressPercent, 10)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      window.alert('Прогресс должен быть числом от 0 до 100.')
      return false
    }
    try {
      await updateStatus.mutateAsync({
        taskId: task.id,
        status,
        progress_percent: parsed,
        next_step: nextStep.trim() || null,
      })
      return true
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось обновить статус задачи'))
      return false
    }
  }

  const handleStatusSaveAndClose = async () => {
    const ok = await handleStatusSave()
    if (ok) onOpenChange(false)
  }

  const handleAssigneeChange = (assigneeIds: string[]) => {
    setSelectedAssigneeIds(assigneeIds)
    updateTask.mutate(
      {
        taskId: task.id,
        data: {
          assignee_ids: assigneeIds,
          assigned_to_id: assigneeIds[0] || null,
        },
      },
      {
        onError: (error: any) => {
          window.alert(humanizeApiError(error, 'Не удалось изменить исполнителей'))
        },
      }
    )
  }

  const handleDelete = async () => {
    if (window.confirm('Delete this task?')) {
      try {
        await deleteTask.mutateAsync(task.id)
        onOpenChange(false)
      } catch (error: any) {
        window.alert(humanizeApiError(error, 'Не удалось удалить задачу'))
      }
    }
  }

  const handleSaveDates = async () => {
    const endDateChanged = endDate !== (task.end_date ?? '')
    const canRequireReason = Boolean(task.end_date) && status !== 'planning'
    if (endDateChanged && canRequireReason) {
      setPendingEndDate(endDate)
      setShowDeadlineReasonModal(true)
      return
    }
    // No end_date change — save directly
    try {
      await updateTask.mutateAsync({
        taskId: task.id,
        data: {
          start_date: startDate || null,
          end_date: endDate || null,
          repeat_every_days: repeatDays ? parseInt(repeatDays) : null,
          is_escalation: isEscalation,
          escalation_for: escalationFor || null,
          escalation_sla_hours: escalationSlaHours ? parseInt(escalationSlaHours) : 24,
        },
      })
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось сохранить даты задачи'))
    }
  }

  const handleDeadlineReasonConfirm = async (reason: string) => {
    try {
      await updateTask.mutateAsync({
        taskId: task.id,
        data: {
          start_date: startDate || null,
          end_date: pendingEndDate || null,
          repeat_every_days: repeatDays ? parseInt(repeatDays) : null,
          is_escalation: isEscalation,
          escalation_for: escalationFor || null,
          escalation_sla_hours: escalationSlaHours ? parseInt(escalationSlaHours) : 24,
          deadline_change_reason: reason,
        },
      })
      setShowDeadlineReasonModal(false)
      setPendingEndDate('')
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось сохранить дедлайн задачи'))
    }
  }

  const handleDeadlineReasonCancel = () => {
    setShowDeadlineReasonModal(false)
    // Revert end date input to original
    setEndDate(task.end_date ?? '')
    setPendingEndDate('')
  }

  const handleAddComment = async () => {
    if (!commentBody.trim()) return
    try {
      await addComment.mutateAsync({ taskId: task.id, body: commentBody.trim() })
      setCommentBody('')
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось добавить комментарий'))
    }
  }

  const handleCheckIn = async () => {
    if (!checkInSummary.trim()) {
      window.alert('Укажите короткий итог по задаче.')
      return
    }
    try {
      await checkInTask.mutateAsync({
        taskId: task.id,
        summary: checkInSummary.trim(),
        blockers: checkInBlockers.trim() || null,
        next_check_in_due_at: checkInNextDueDate
          ? new Date(checkInNextDueDate).toISOString()
          : null,
        need_manager_help: needManagerHelp,
      })
      setCheckInSummary('')
      setCheckInBlockers('')
      setNeedManagerHelp(false)
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось сохранить check-in'))
    }
  }

  const handleAddDependency = async () => {
    if (!newDependencyTaskId) return
    const lagDays = Number.parseInt(newDependencyLagDays || '0', 10)
    if (!Number.isFinite(lagDays) || lagDays < 0) {
      window.alert('Лаг должен быть целым числом 0 или больше.')
      return
    }
    try {
      await addDependency.mutateAsync({
        taskId: task.id,
        predecessorTaskId: newDependencyTaskId,
        dependencyType: newDependencyType,
        lagDays,
      })
      setNewDependencyTaskId('')
      setNewDependencyType('finish_to_start')
      setNewDependencyLagDays('0')
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось сохранить связь задач'))
    }
  }

  const handleSaveParentTask = async () => {
    try {
      await updateTask.mutateAsync({
        taskId: task.id,
        data: {
          parent_task_id: selectedParentTaskId || null,
        },
      })
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось сохранить родительскую задачу'))
    }
  }

  const handleRemoveDependency = async (predecessorTaskId: string) => {
    try {
      await removeDependency.mutateAsync({ taskId: task.id, predecessorTaskId })
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось удалить связь задач'))
    }
  }

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onOpenChange(false)
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement | null
    if (!target) return
    const tagName = target.tagName
    if (tagName === 'TEXTAREA') return
    if (target.closest('[data-enter-ignore="true"]')) return
    event.preventDefault()
    event.stopPropagation()
    void handleStatusSaveAndClose()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[96vw] max-w-7xl h-[88vh]" onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{task.title}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 overflow-y-auto pr-1 h-full lg:grid-cols-2">
            {/* Priority & Status */}
            <div className="flex items-center gap-2 flex-wrap lg:col-span-2">
              <span
                className={`text-xs px-2 py-1 rounded-full font-medium ${PRIORITY_COLORS[controlSki ? 'critical' : priority]}`}
              >
                {controlSki ? 'critical · СКИ' : priority}
              </span>
              <select
                value={controlSki ? 'critical' : priority}
                onChange={(e) => void handlePriorityChange(e.target.value)}
                className="text-sm border rounded px-2 py-1 bg-background"
                disabled={controlSki || updateTask.isPending}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <span>Контроль СКИ</span>
                <Switch
                  checked={controlSki}
                  onCheckedChange={(checked) => void handleControlSkiChange(checked)}
                  disabled={updateTask.isPending}
                />
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="text-sm border rounded px-2 py-1 bg-background"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleStatusSave()}
                disabled={updateStatus.isPending}
              >
                {updateStatus.isPending ? 'Сохранение...' : 'Обновить статус'}
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => void handleStatusSaveAndClose()}
                disabled={updateStatus.isPending}
              >
                {updateStatus.isPending ? 'Сохранение...' : 'Обновить и закрыть (Enter)'}
              </Button>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Прогресс, %</label>
              <input
                type="number"
                min={0}
                max={100}
                value={progressPercent}
                onChange={(e) => setProgressPercent(e.target.value)}
                className="w-full text-sm border rounded px-2 py-1 bg-background"
              />
              <label className="text-xs text-muted-foreground">Следующий шаг</label>
              <input
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
                className="w-full text-sm border rounded px-2 py-1 bg-background"
                placeholder="Например: согласовать ТЗ с отделом ИБ"
              />
            </div>

            {/* Description */}
            {task.description && (
              <p className="text-sm text-muted-foreground">{task.description}</p>
            )}

            <div className="rounded-lg border p-3 space-y-2" data-enter-ignore="true">
              <p className="text-sm font-medium">Check-in (без смены статуса)</p>
              <p className="text-xs text-muted-foreground">
                Последний check-in: {task.last_check_in_at ? new Date(task.last_check_in_at).toLocaleString('ru-RU') : 'нет'}
              </p>
              <p className="text-xs text-muted-foreground">
                Следующий due: {task.next_check_in_due_at ? new Date(task.next_check_in_due_at).toLocaleString('ru-RU') : 'не назначен'}
              </p>
              <input
                value={checkInSummary}
                onChange={(e) => setCheckInSummary(e.target.value)}
                className="w-full text-sm border rounded px-2 py-1 bg-background"
                placeholder="Коротко: что продвинулось с прошлого check-in"
              />
              <input
                value={checkInBlockers}
                onChange={(e) => setCheckInBlockers(e.target.value)}
                className="w-full text-sm border rounded px-2 py-1 bg-background"
                placeholder="Блокеры (необязательно)"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Следующий check-in до</label>
                <input
                  type="datetime-local"
                  value={checkInNextDueDate}
                  onChange={(e) => setCheckInNextDueDate(e.target.value)}
                  className="text-sm border rounded px-2 py-1 bg-background"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <span>Нужна помощь менеджера</span>
                <Switch
                  checked={needManagerHelp}
                  onCheckedChange={setNeedManagerHelp}
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCheckIn}
                disabled={checkInTask.isPending}
              >
                {checkInTask.isPending ? 'Сохранение...' : 'Отметиться (Check-in)'}
              </Button>
            </div>

            <div className="rounded-lg border p-3 space-y-2" data-enter-ignore="true">
              <p className="text-sm font-medium">Родительская задача (структура)</p>
              <p className="text-xs text-muted-foreground">
                Это только иерархия. Для блокировки старта используйте раздел зависимостей ниже.
              </p>
              <div className="flex items-center gap-2">
                <TaskCombobox
                  value={selectedParentTaskId}
                  onChange={setSelectedParentTaskId}
                  tasks={taskHierarchyOptions.ordered.filter((c) => !blockedParentIds.has(c.id))}
                  depthById={taskHierarchyOptions.depthById}
                  numbering={taskNumbering}
                  placeholder="Без родителя"
                  emptyLabel="Без родителя"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSaveParentTask}
                  disabled={updateTask.isPending}
                >
                  Сохранить
                </Button>
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-2" data-enter-ignore="true">
              <p className="text-sm font-medium">Связанные задачи (зависимости)</p>
              <p className="text-xs text-muted-foreground">
                FS блокирует старт до завершения предшественника. SS/FF синхронизируют старт/финиш.
              </p>
              <div className="flex items-center gap-2">
                <TaskCombobox
                  value={newDependencyTaskId}
                  onChange={setNewDependencyTaskId}
                  tasks={taskHierarchyOptions.ordered.filter((t) => t.id !== task.id)}
                  depthById={taskHierarchyOptions.depthById}
                  numbering={taskNumbering}
                  placeholder="Выберите предшественника"
                  emptyLabel="Выберите предшественника"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddDependency}
                  disabled={!newDependencyTaskId || addDependency.isPending}
                >
                  Добавить
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={newDependencyType}
                  onChange={(e) =>
                    setNewDependencyType(e.target.value as 'finish_to_start' | 'start_to_start' | 'finish_to_finish')
                  }
                  className="text-sm border rounded px-2 py-1 bg-background flex-1"
                >
                  <option value="finish_to_start">FS (Окончание-Начало)</option>
                  <option value="start_to_start">SS (Начало-Начало)</option>
                  <option value="finish_to_finish">FF (Окончание-Окончание)</option>
                </select>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={newDependencyLagDays}
                  onChange={(e) => setNewDependencyLagDays(e.target.value)}
                  className="text-sm border rounded px-2 py-1 bg-background w-28"
                  placeholder="Лаг, дни"
                />
              </div>
              <div className="space-y-1">
                {dependencies.length === 0 && (
                  <p className="text-xs text-muted-foreground">Связей пока нет.</p>
                )}
                {dependencies.map((dep) => {
                  const predecessor = projectTasks.find((t) => t.id === dep.predecessor_task_id)
                  return (
                    <div key={`${dep.predecessor_task_id}-${dep.successor_task_id}`} className="flex items-center justify-between text-sm border rounded px-2 py-1">
                      <span>
                        {predecessor?.title ?? dep.predecessor_task_id}
                        <span className="text-xs text-muted-foreground ml-1">
                          · {DEPENDENCY_TYPE_LABELS[dep.dependency_type] ?? dep.dependency_type}
                          {dep.lag_days > 0 ? ` · +${dep.lag_days}д` : ''}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveDependency(dep.predecessor_task_id)}
                        disabled={removeDependency.isPending}
                      >
                        Разорвать
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Meta */}
            <div className="space-y-2 text-sm">
              {/* Assignee selector */}
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground shrink-0" />
                <select
                  multiple
                  value={selectedAssigneeIds}
                  onChange={(e) =>
                    handleAssigneeChange(
                      Array.from(e.target.selectedOptions).map((option) => option.value)
                    )
                  }
                  className="text-sm border rounded px-2 py-1 bg-background flex-1 min-h-[96px]"
                >
                  {assigneeOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {formatUserDisplayName(u)} ({u.role})
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">Можно выбрать нескольких исполнителей (Ctrl/Cmd + клик).</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="w-4 h-4" />
                  <span>Дедлайн и даты</span>
                  {deadlineHistory.length > 0 && (
                    <span className="ml-auto text-xs text-amber-600 font-medium">
                      Переносился {deadlineHistory.length} раз
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="text-sm border rounded px-2 py-1 bg-background"
                  />
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="text-sm border rounded px-2 py-1 bg-background"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveDates}
                  disabled={updateTask.isPending}
                >
                  {updateTask.isPending ? 'Сохранение...' : 'Сохранить даты'}
                </Button>

                {/* Deadline history collapsible */}
                {deadlineHistory.length > 0 && (
                  <div className="rounded border bg-muted/30">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowDeadlineHistory(!showDeadlineHistory)}
                    >
                      <span>История переносов дедлайна</span>
                      {showDeadlineHistory ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {showDeadlineHistory && (
                      <div className="px-3 pb-2 space-y-1.5 border-t">
                        {deadlineHistory.map((change) => (
                          <div key={change.id} className="pt-2 text-xs">
                            <div className="flex items-center justify-between text-muted-foreground">
                              <span>
                                {new Date(change.created_at).toLocaleDateString('ru-RU')}
                                {change.changed_by && ` · ${formatUserDisplayName(change.changed_by)}`}
                              </span>
                              <span>
                                {new Date(change.old_date).toLocaleDateString('ru-RU')} →{' '}
                                {new Date(change.new_date).toLocaleDateString('ru-RU')}
                              </span>
                            </div>
                            <p className="text-foreground mt-0.5 italic">"{change.reason}"</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* ── Time tracking ── */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Учёт времени</p>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground mb-1 block">План (ч)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={estimatedHours}
                      onChange={(e) => setEstimatedHours(e.target.value)}
                      className="w-full text-sm border rounded px-2 py-1 bg-background"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground mb-1 block">Факт (ч)</label>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={actualHours}
                      onChange={(e) => setActualHours(e.target.value)}
                      className="w-full text-sm border rounded px-2 py-1 bg-background"
                      placeholder="0"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await updateTask.mutateAsync({
                          taskId: task.id,
                          data: {
                            estimated_hours: estimatedHours ? parseInt(estimatedHours) : null,
                            actual_hours: actualHours ? parseFloat(actualHours) : null,
                          },
                        })
                      } catch (err: any) {
                        window.alert(humanizeApiError(err, 'Не удалось сохранить часы'))
                      }
                    }}
                  >
                    Сохранить
                  </Button>
                </div>
                {(task.estimated_hours != null || task.actual_hours != null) && (() => {
                  const est = task.estimated_hours ?? 0
                  const act = Number(task.actual_hours ?? 0)
                  const pct = est > 0 ? Math.round((act / est) * 100) : null
                  return (
                    <div className="text-xs text-muted-foreground flex gap-3">
                      {task.estimated_hours != null && <span>План: <b>{task.estimated_hours}ч</b></span>}
                      {task.actual_hours != null && <span>Факт: <b>{act}ч</b></span>}
                      {pct != null && (
                        <span className={pct > 100 ? 'text-red-500 font-semibold' : 'text-green-600'}>
                          {pct}% от плана
                        </span>
                      )}
                    </div>
                  )
                })()}
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <span>Эскалация на руководителя</span>
                  <Switch
                    checked={isEscalation}
                    onCheckedChange={setIsEscalation}
                  />
                </label>
                {isEscalation && (
                  <div className="space-y-2">
                    <input
                      value={escalationFor}
                      onChange={(e) => setEscalationFor(e.target.value)}
                      className="w-full text-sm border rounded px-2 py-1 bg-background"
                      placeholder="Описание проблемы для эскалации"
                    />
                    <input
                      type="number"
                      min={1}
                      value={escalationSlaHours}
                      onChange={(e) => setEscalationSlaHours(e.target.value)}
                      className="w-full text-sm border rounded px-2 py-1 bg-background"
                      placeholder="SLA реакции (часы)"
                    />
                    {task.escalation_due_at && (
                      <p className="text-xs text-muted-foreground">
                        Срок реакции: {new Date(task.escalation_due_at).toLocaleString('ru')}
                      </p>
                    )}
                    {task.escalation_first_response_at && (
                      <p className="text-xs text-emerald-700">
                        Первая реакция: {new Date(task.escalation_first_response_at).toLocaleString('ru')}
                      </p>
                    )}
                    {task.escalation_overdue_at && (
                      <p className="text-xs text-red-700">
                        SLA просрочен: {new Date(task.escalation_overdue_at).toLocaleString('ru')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Custom fields */}
            <div className="border-t pt-3">
              <CustomFieldsPanel taskId={task.id} projectId={task.project_id} />
            </div>

            {/* External deps / contractors */}
            <div className="border-t pt-3" data-enter-ignore="true">
              <ExternalDepsPanel taskId={task.id} />
            </div>

            <div className="space-y-2 border-t pt-3" data-enter-ignore="true">
              <p className="text-sm font-medium">Комментарии</p>
              <div className="space-y-2 max-h-32 overflow-auto">
                {comments.length === 0 && (
                  <p className="text-xs text-muted-foreground">Комментариев пока нет.</p>
                )}
                {comments.map((c) => (
                  <div key={c.id} className="text-xs rounded border p-2">
                    <p className="font-medium">{formatUserDisplayName(c.author) || 'Пользователь'}</p>
                    <p className="text-muted-foreground">{c.body}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Добавить комментарий..."
                  className="flex-1 text-sm border rounded px-2 py-1 bg-background"
                />
                <Button size="sm" variant="outline" onClick={handleAddComment}>
                  Добавить
                </Button>
              </div>
            </div>

            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">История</p>
              <div className="space-y-1 max-h-28 overflow-auto">
                {events.length === 0 && (
                  <p className="text-xs text-muted-foreground">Событий пока нет.</p>
                )}
                {events.map((e) => (
                  <div key={e.id} className="text-xs text-muted-foreground">
                    <span>
                      {new Date(e.created_at).toLocaleString('ru')}
                      {e.actor ? ` · ${formatUserDisplayName(e.actor)}` : ''}
                      {' · '}
                      {formatTaskEvent(e.event_type, e.payload)}
                    </span>
                    {e.reason && (
                      <p className="italic text-foreground/70 mt-0.5">"{e.reason}"</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end pt-2 lg:col-span-2">
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                <Trash2 className="w-4 h-4 mr-1" />
                Удалить
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DeadlineReasonModal
        open={showDeadlineReasonModal}
        oldDate={task.end_date ?? ''}
        newDate={pendingEndDate}
        onConfirm={handleDeadlineReasonConfirm}
        onCancel={handleDeadlineReasonCancel}
      />
    </>
  )
}
