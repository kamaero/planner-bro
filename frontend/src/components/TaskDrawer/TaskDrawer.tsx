import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  useUpdateTaskStatus,
  useDeleteTask,
  useUpdateTask,
  useTaskCheckIn,
  useTaskComments,
  useAddTaskComment,
  useTaskEvents,
  useTaskDeadlineHistory,
} from '@/hooks/useProjects'
import { useUsers } from '@/hooks/useUsers'
import type { Task } from '@/types'
import { CalendarDays, Clock, User, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { DeadlineReasonModal } from '@/components/DeadlineReasonModal/DeadlineReasonModal'

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

const STATUS_OPTIONS = ['todo', 'in_progress', 'review', 'done'] as const
const STATUS_LABELS: Record<string, string> = {
  todo: 'К выполнению',
  in_progress: 'В работе',
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
  const updateStatus = useUpdateTaskStatus()
  const deleteTask = useDeleteTask()
  const updateTask = useUpdateTask()
  const checkInTask = useTaskCheckIn()
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

  const { data: comments = [] } = useTaskComments(task?.id)
  const { data: events = [] } = useTaskEvents(task?.id)
  const { data: deadlineHistory = [] } = useTaskDeadlineHistory(task?.id)

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
    setIsEscalation(!!task.is_escalation)
    setEscalationFor(task.escalation_for ?? '')
    setEscalationSlaHours(String(task.escalation_sla_hours ?? 24))
    setCheckInSummary('')
    setCheckInBlockers('')
    setCheckInNextDueDate(
      task.next_check_in_due_at ? new Date(task.next_check_in_due_at).toISOString().slice(0, 16) : ''
    )
    setNeedManagerHelp(false)
  }, [task])

  if (!task) return null

  const handlePriorityChange = async (nextPriority: string) => {
    const p = nextPriority as 'low' | 'medium' | 'high' | 'critical'
    setPriority(p)
    await updateTask.mutateAsync({
      taskId: task.id,
      data: {
        priority: controlSki ? 'critical' : p,
        control_ski: controlSki,
      },
    })
  }

  const handleControlSkiChange = async (checked: boolean) => {
    const nextControl = checked
    const nextPriority = nextControl ? 'critical' : priority === 'critical' ? 'medium' : priority
    setControlSki(nextControl)
    setPriority(nextPriority)
    await updateTask.mutateAsync({
      taskId: task.id,
      data: {
        control_ski: nextControl,
        priority: nextControl ? 'critical' : nextPriority,
      },
    })
  }

  const handleStatusSave = async () => {
    const parsed = Number.parseInt(progressPercent, 10)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      window.alert('Прогресс должен быть числом от 0 до 100.')
      return
    }
    await updateStatus.mutateAsync({
      taskId: task.id,
      status,
      progress_percent: parsed,
      next_step: nextStep.trim() || null,
    })
  }

  const handleAssigneeChange = (assignedToId: string) => {
    updateTask.mutate({
      taskId: task.id,
      data: { assigned_to_id: assignedToId || null },
    })
  }

  const handleDelete = async () => {
    if (window.confirm('Delete this task?')) {
      await deleteTask.mutateAsync(task.id)
      onOpenChange(false)
    }
  }

  const handleSaveDates = async () => {
    const endDateChanged = endDate !== (task.end_date ?? '')
    if (endDateChanged && endDate) {
      // Need reason for changing end_date
      setPendingEndDate(endDate)
      setShowDeadlineReasonModal(true)
      return
    }
    // No end_date change or clearing it — save directly
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
  }

  const handleDeadlineReasonConfirm = async (reason: string) => {
    setShowDeadlineReasonModal(false)
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
    setPendingEndDate('')
  }

  const handleDeadlineReasonCancel = () => {
    setShowDeadlineReasonModal(false)
    // Revert end date input to original
    setEndDate(task.end_date ?? '')
    setPendingEndDate('')
  }

  const handleAddComment = async () => {
    if (!commentBody.trim()) return
    await addComment.mutateAsync({ taskId: task.id, body: commentBody.trim() })
    setCommentBody('')
  }

  const handleCheckIn = async () => {
    if (!checkInSummary.trim()) {
      window.alert('Укажите короткий итог по задаче.')
      return
    }
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
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{task.title}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Priority & Status */}
            <div className="flex items-center gap-2 flex-wrap">
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
                <input
                  type="checkbox"
                  checked={controlSki}
                  onChange={(e) => void handleControlSkiChange(e.target.checked)}
                  className="h-4 w-4"
                  disabled={updateTask.isPending}
                />
                Контроль СКИ
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
                onClick={handleStatusSave}
                disabled={updateStatus.isPending}
              >
                {updateStatus.isPending ? 'Сохранение...' : 'Обновить статус'}
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

            <div className="rounded-lg border p-3 space-y-2">
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
                <input
                  type="checkbox"
                  checked={needManagerHelp}
                  onChange={(e) => setNeedManagerHelp(e.target.checked)}
                />
                Нужна помощь менеджера
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

            {/* Meta */}
            <div className="space-y-2 text-sm">
              {/* Assignee selector */}
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground shrink-0" />
                <select
                  value={task.assigned_to_id ?? ''}
                  onChange={(e) => handleAssigneeChange(e.target.value)}
                  className="text-sm border rounded px-2 py-1 bg-background flex-1"
                >
                  <option value="">Не назначен</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </select>
              </div>
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
                                {change.changed_by && ` · ${change.changed_by.name}`}
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
              {task.estimated_hours && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span>{task.estimated_hours}h estimated</span>
                </div>
              )}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isEscalation}
                    onChange={(e) => setIsEscalation(e.target.checked)}
                  />
                  Эскалация на руководителя
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

            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">Комментарии</p>
              <div className="space-y-2 max-h-32 overflow-auto">
                {comments.length === 0 && (
                  <p className="text-xs text-muted-foreground">Комментариев пока нет.</p>
                )}
                {comments.map((c) => (
                  <div key={c.id} className="text-xs rounded border p-2">
                    <p className="font-medium">{c.author?.name ?? 'Пользователь'}</p>
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
                    <span>{new Date(e.created_at).toLocaleString('ru')} · {formatTaskEvent(e.event_type, e.payload)}</span>
                    {e.reason && (
                      <p className="italic text-foreground/70 mt-0.5">"{e.reason}"</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end pt-2">
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
