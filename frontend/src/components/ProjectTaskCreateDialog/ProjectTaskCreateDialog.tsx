import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { Link } from 'react-router-dom'

import { AssigneePicker } from '@/components/AssigneePicker/AssigneePicker'
import { TaskRelationPicker } from '@/components/TaskRelationPicker/TaskRelationPicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { Task, User } from '@/types'
import { Plus } from 'lucide-react'

export interface ProjectTaskFormState {
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

interface ProjectTaskCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  taskForm: ProjectTaskFormState
  setTaskForm: Dispatch<SetStateAction<ProjectTaskFormState>>
  projectAssigneeOptions: User[]
  taskHierarchyOptions: {
    ordered: Task[]
    depthById: Map<string, number>
  }
  isPending: boolean
}

export function ProjectTaskCreateDialog({
  open,
  onOpenChange,
  onSubmit,
  taskForm,
  setTaskForm,
  projectAssigneeOptions,
  taskHierarchyOptions,
  isPending,
}: ProjectTaskCreateDialogProps) {
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
            <Label>Исполнители</Label>
            <AssigneePicker
              users={projectAssigneeOptions}
              value={taskForm.assignee_ids}
              onChange={(values) =>
                setTaskForm((f) => ({ ...f, assignee_ids: values, assigned_to_id: values[0] ?? '' }))
              }
              placeholder="Поиск по имени, почте или должности"
            />
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-foreground">Подсказка по назначению</p>
                <Link
                  to="/help#assignment-policy"
                  className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                >
                  Политика назначений
                </Link>
              </div>
              <div className="mt-2 space-y-1.5">
                <p>1. Можно выбрать сразу нескольких исполнителей через поиск и чекбоксы.</p>
                <p>2. Если нужного человека нет в списке, проверьте роль, отдел и политику видимости.</p>
                <p>3. Для кросс-отдельских назначений чаще нужны роли руководителя, администратора, ГИПа или ЗАМа.</p>
              </div>
            </div>
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label>Родительская задача (структура)</Label>
            <TaskRelationPicker
              tasks={taskHierarchyOptions.ordered}
              depthById={taskHierarchyOptions.depthById}
              value={taskForm.parent_task_id}
              onChange={(next) => setTaskForm((f) => ({ ...f, parent_task_id: String(next) }))}
              emptyLabel="Без родителя"
              placeholder="Найти родительскую задачу"
            />
            <p className="text-xs text-muted-foreground">
              Parent задаёт только структуру. Для запрета старта используйте поле ниже.{' '}
              <Link to="/help#dependencies" className="font-medium text-primary hover:text-primary/80">
                Подробнее
              </Link>
            </p>
          </div>
          <div className="space-y-1">
            <Label>Зависит от (блокировка старта)</Label>
            <TaskRelationPicker
              tasks={taskHierarchyOptions.ordered}
              depthById={taskHierarchyOptions.depthById}
              value={taskForm.predecessor_task_ids}
              onChange={(next) => setTaskForm((f) => ({ ...f, predecessor_task_ids: next as string[] }))}
              multiple
              emptyLabel="Предшественников пока нет"
              placeholder="Найти предшествующую задачу"
            />
            <p className="text-xs text-muted-foreground">
              Эти задачи должны быть в статусе "Выполнено", прежде чем новая задача перейдет в работу.
            </p>
            <p className="text-xs text-muted-foreground">
              Для продвинутых типов связей `FS / SS / FF` используйте редактирование уже созданной задачи.{' '}
              <Link to="/help#dependencies" className="font-medium text-primary hover:text-primary/80">
                Подробнее
              </Link>
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
