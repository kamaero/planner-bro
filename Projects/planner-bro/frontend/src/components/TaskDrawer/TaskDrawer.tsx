import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  useUpdateTaskStatus,
  useDeleteTask,
  useUpdateTask,
  useTaskComments,
  useAddTaskComment,
  useTaskEvents,
} from '@/hooks/useProjects'
import { useMembers } from '@/hooks/useMembers'
import type { Task } from '@/types'
import { CalendarDays, Clock, User, Trash2 } from 'lucide-react'

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
  const addComment = useAddTaskComment()
  const { data: members = [] } = useMembers(projectId)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [status, setStatus] = useState('todo')
  const [progressPercent, setProgressPercent] = useState('0')
  const [nextStep, setNextStep] = useState('')
  const [repeatDays, setRepeatDays] = useState('')
  const [isEscalation, setIsEscalation] = useState(false)
  const [escalationFor, setEscalationFor] = useState('')
  const [escalationSlaHours, setEscalationSlaHours] = useState('24')
  const [commentBody, setCommentBody] = useState('')

  const { data: comments = [] } = useTaskComments(task?.id)
  const { data: events = [] } = useTaskEvents(task?.id)

  useEffect(() => {
    if (!task) return
    setStartDate(task.start_date ?? '')
    setEndDate(task.end_date ?? '')
    setStatus(task.status)
    setProgressPercent(String(task.progress_percent ?? 0))
    setNextStep(task.next_step ?? '')
    setRepeatDays(task.repeat_every_days ? String(task.repeat_every_days) : '')
    setIsEscalation(!!task.is_escalation)
    setEscalationFor(task.escalation_for ?? '')
    setEscalationSlaHours(String(task.escalation_sla_hours ?? 24))
  }, [task])

  if (!task) return null

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

  const handleAddComment = async () => {
    if (!commentBody.trim()) return
    await addComment.mutateAsync({ taskId: task.id, body: commentBody.trim() })
    setCommentBody('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Priority & Status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${PRIORITY_COLORS[task.priority]}`}>
              {task.priority}
            </span>
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
                {members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarDays className="w-4 h-4" />
                <span>Дедлайн и даты</span>
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
                <p key={e.id} className="text-xs text-muted-foreground">
                  {new Date(e.created_at).toLocaleString('ru')} · {formatTaskEvent(e.event_type, e.payload)}
                </p>
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
  )
}
