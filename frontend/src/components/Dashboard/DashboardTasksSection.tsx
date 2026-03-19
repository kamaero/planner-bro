import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { formatUserDisplayName } from '@/lib/userName'
import type { Task, User } from '@/types'
import type { FormEvent, ReactNode } from 'react'

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function CardShell({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('h-full rounded-xl border bg-card p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  )
}

type UrgentForm = {
  title: string
  description: string
  assignee_id: string
  end_date: string
  control_ski: boolean
}

type DashboardUrgentTasksCardProps = {
  urgentForm: UrgentForm
  users: User[]
  createTaskPending: boolean
  onUrgentSubmit: (e: FormEvent) => void
  onUrgentFormChange: (patch: Partial<UrgentForm>) => void
}

type DashboardMyTasksCardProps = {
  myUrgentTasks: Task[]
  taskStatusLabel: Record<string, string>
  formatDate: (value?: string) => string
  daysUntil: (value?: string) => number | null
  myTaskUrgencyClass: (days: number | null) => string
}

export function DashboardUrgentTasksCard({
  urgentForm,
  users,
  createTaskPending,
  onUrgentSubmit,
  onUrgentFormChange,
}: DashboardUrgentTasksCardProps) {
  return (
    <CardShell title="Срочные задачи" className="xl:col-span-2">
      <form className="space-y-2" onSubmit={onUrgentSubmit}>
        <Input
          value={urgentForm.title}
          onChange={(e) => onUrgentFormChange({ title: e.target.value })}
          placeholder="Быстрая заметка / задача"
          className="h-8 text-xs"
          required
        />
        <Input
          value={urgentForm.description}
          onChange={(e) => onUrgentFormChange({ description: e.target.value })}
          placeholder="Комментарий"
          className="h-8 text-xs"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={urgentForm.assignee_id}
            onChange={(e) => onUrgentFormChange({ assignee_id: e.target.value })}
            className="rounded border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">Ответственный</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{formatUserDisplayName(user)}</option>
            ))}
          </select>
          <Input
            type="date"
            value={urgentForm.end_date}
            onChange={(e) => onUrgentFormChange({ end_date: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <label className="flex items-center justify-between gap-3 text-xs">
          <span>Контроль СКИ</span>
          <Switch
            checked={urgentForm.control_ski}
            onCheckedChange={(checked) => onUrgentFormChange({ control_ski: checked })}
          />
        </label>
        <p className="text-[11px] text-muted-foreground">По умолчанию: приоритет Высокий</p>
        <p className="text-[11px] text-muted-foreground">Создаются в отдельном inbox «Срочные задачи (вне проектов)»</p>
        <Button type="submit" className="w-full" size="sm" disabled={createTaskPending}>
          {createTaskPending ? 'Создание...' : 'Добавить срочную задачу'}
        </Button>
      </form>
    </CardShell>
  )
}

export function DashboardMyTasksCard({
  myUrgentTasks,
  taskStatusLabel,
  formatDate,
  daysUntil,
  myTaskUrgencyClass,
}: DashboardMyTasksCardProps) {
  return (
    <CardShell title="Мои задачи" className="xl:col-span-3">
      <div className="max-h-64 space-y-2 overflow-auto">
        {myUrgentTasks.length === 0 && <p className="text-sm text-muted-foreground">Личных задач нет.</p>}
        {myUrgentTasks.map((task) => {
          const d = daysUntil(task.end_date)
          return (
            <Link
              key={task.id}
              to={`/projects/${task.project_id}?task=${task.id}`}
              className={cn('block rounded border px-2 py-1.5 text-xs transition-colors', myTaskUrgencyClass(d))}
            >
              <p className="truncate font-medium">{task.title}</p>
              <p className="text-muted-foreground">
                {taskStatusLabel[task.status] ?? task.status} · {formatDate(task.end_date)}
                {d === null ? ' · без дедлайна' : d < 0 ? ' · просрочено' : ` · ${d} дн.`}
              </p>
            </Link>
          )
        })}
      </div>
    </CardShell>
  )
}
