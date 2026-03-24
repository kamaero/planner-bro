import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatUserDisplayName } from '@/lib/userName'
import { Plus } from 'lucide-react'
import type { User, Task } from '@/types'

export type TaskCreateFormState = {
  title: string
  description: string
  priority: string
  control_ski: boolean
  progress_percent: string
  next_step: string
  start_date: string
  end_date: string
  estimated_hours: string
  assigned_to_id: string
  assignee_ids: string[]
  parent_task_id: string
  predecessor_task_ids: string[]
  is_escalation: boolean
  escalation_for: string
  escalation_sla_hours: string
  repeat_every_days: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskForm: TaskCreateFormState
  setTaskForm: React.Dispatch<React.SetStateAction<TaskCreateFormState>>
  onSubmit: (e: React.FormEvent) => void
  isPending: boolean
  assigneeOptions: User[]
  hierarchyOptions: { ordered: Task[]; depthById: Map<string, number> }
}

export function ProjectTaskCreateDialog({
  open,
  onOpenChange,
  taskForm,
  setTaskForm,
  onSubmit,
  isPending,
  assigneeOptions,
  hierarchyOptions,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-1" />
          Добавить задачу
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[88vh]">
        <DialogHeader>
          <DialogTitle>Создать задачу</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto max-h-[72vh] pr-1">
          <div className="space-y-1 lg:col-span-2">
            <Label>Название</Label>
            <Input
              value={taskForm.title}
              onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))}
              required
              placeholder="Название задачи"
            />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label>Описание</Label>
            <Input
              value={taskForm.description}
              onChange={(e) => setTaskForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Необязательно"
            />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label>Приоритет</Label>
            <div className="flex items-center gap-3">
              <select
                value={taskForm.control_ski ? 'critical' : taskForm.priority}
                onChange={(e) => setTaskForm((f) => ({ ...f, priority: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                disabled={taskForm.control_ski}
              >
                <option value="low">Низкий</option>
                <option value="medium">Средний</option>
                <option value="high">Высокий</option>
                <option value="critical">Критический</option>
              </select>
              <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                <span>Контроль СКИ</span>
                <Switch
                  checked={taskForm.control_ski}
                  onCheckedChange={(checked) =>
                    setTaskForm((f) => ({
                      ...f,
                      control_ski: checked,
                      priority: checked ? 'critical' : f.priority,
                    }))
                  }
                />
              </label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Прогресс, %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={taskForm.progress_percent}
                onChange={(e) => setTaskForm((f) => ({ ...f, progress_percent: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Следующий шаг</Label>
              <Input
                value={taskForm.next_step}
                onChange={(e) => setTaskForm((f) => ({ ...f, next_step: e.target.value }))}
                placeholder="Необязательно"
              />
            </div>
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label>Исполнитель</Label>
            <select
              multiple
              value={taskForm.assignee_ids}
              onChange={(e) => {
                const values = Array.from(e.target.selectedOptions).map((option) => option.value)
                setTaskForm((f) => ({ ...f, assignee_ids: values, assigned_to_id: values[0] ?? '' }))
              }}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[112px]"
            >
              {assigneeOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {formatUserDisplayName(u)} ({u.role})
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Можно выбрать нескольких исполнителей (Ctrl/Cmd + клик).</p>
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label>Родительская задача (структура)</Label>
            <select
              value={taskForm.parent_task_id}
              onChange={(e) => setTaskForm((f) => ({ ...f, parent_task_id: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              <option value="">Без родителя</option>
              {hierarchyOptions.ordered.map((t) => (
                <option key={t.id} value={t.id}>
                  {`${'· '.repeat(hierarchyOptions.depthById.get(t.id) ?? 0)}${t.title}`}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Зависит от (блокировка старта)</Label>
            <select
              multiple
              value={taskForm.predecessor_task_ids}
              onChange={(e) => {
                const values = Array.from(e.target.selectedOptions).map((option) => option.value)
                setTaskForm((f) => ({ ...f, predecessor_task_ids: values }))
              }}
              className="w-full border rounded px-3 py-2 text-sm bg-background min-h-[112px]"
            >
              {hierarchyOptions.ordered.map((t) => (
                <option key={t.id} value={t.id}>
                  {`${'· '.repeat(hierarchyOptions.depthById.get(t.id) ?? 0)}${t.title}`}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Эти задачи должны быть в статусе "Выполнено", прежде чем новая задача перейдет в работу.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Дата начала</Label>
              <Input
                type="date"
                value={taskForm.start_date}
                onChange={(e) => setTaskForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Дедлайн</Label>
              <Input
                type="date"
                value={taskForm.end_date}
                onChange={(e) => setTaskForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Оценка часов</Label>
            <Input
              type="number"
              value={taskForm.estimated_hours}
              onChange={(e) => setTaskForm((f) => ({ ...f, estimated_hours: e.target.value }))}
              placeholder="например, 8"
            />
          </div>
          <div className="space-y-1">
            <Label>Повторять каждые (дней)</Label>
            <Input
              type="number"
              value={taskForm.repeat_every_days}
              onChange={(e) => setTaskForm((f) => ({ ...f, repeat_every_days: e.target.value }))}
              placeholder="например, 7"
            />
          </div>
          <label className="flex items-center gap-2 text-sm lg:col-span-2">
            <input
              type="checkbox"
              checked={taskForm.is_escalation}
              onChange={(e) => setTaskForm((f) => ({ ...f, is_escalation: e.target.checked }))}
            />
            Эскалация на руководителя
          </label>
          {taskForm.is_escalation && (
            <div className="space-y-1 lg:col-span-2">
              <Label>Причина эскалации</Label>
              <Input
                value={taskForm.escalation_for}
                onChange={(e) => setTaskForm((f) => ({ ...f, escalation_for: e.target.value }))}
                placeholder="Что заблокировано и какое решение нужно"
              />
              <Label className="pt-2">SLA реакции (часы)</Label>
              <Input
                type="number"
                min={1}
                value={taskForm.escalation_sla_hours}
                onChange={(e) =>
                  setTaskForm((f) => ({
                    ...f,
                    escalation_sla_hours: e.target.value,
                  }))
                }
                placeholder="24"
              />
            </div>
          )}
          <Button type="submit" className="w-full lg:col-span-2" disabled={isPending}>
            {isPending ? 'Создание...' : 'Создать задачу'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
