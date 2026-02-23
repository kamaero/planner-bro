import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useProjects, useCreateProject, useAllTasks } from '@/hooks/useProjects'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Plus, FolderOpen, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { Task, Project } from '@/types'

// ─── helpers ──────────────────────────────────────────────────────────────────

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ')
}

const DEFAULT_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6']

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  todo:        { label: 'К выполнению', color: '#94a3b8' },
  in_progress: { label: 'В работе',     color: '#6366f1' },
  review:      { label: 'На проверке',  color: '#f59e0b' },
  done:        { label: 'Выполнено',    color: '#22c55e' },
}

const TASK_BADGE: Record<string, string> = {
  todo:        'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  review:      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  done:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}

// ─── small components ─────────────────────────────────────────────────────────

function SectionCard({
  title,
  children,
  action,
  className,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border bg-card p-5', className)}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function MetricCard({
  label,
  value,
  icon,
  iconColor,
  bgColor,
}: {
  label: string
  value: number
  icon: React.ReactNode
  iconColor: string
  bgColor: string
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', bgColor)}>
          <span className={iconColor}>{icon}</span>
        </div>
      </div>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

function ActivityChart({ data }: { data: { label: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: 'hsl(var(--accent))' }}
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: 12,
          }}
          formatter={(val: number) => [val, 'задач']}
        />
        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function StatusList({
  items,
  total,
}: {
  items: { key: string; label: string; color: string; count: number }[]
  total: number
}) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.key}>
          <div className="flex items-center justify-between text-sm mb-1.5">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-muted-foreground">{item.label}</span>
            </div>
            <span className="font-semibold tabular-nums">{item.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: total > 0 ? `${(item.count / total) * 100}%` : '0%',
                backgroundColor: item.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function ProjectProgressList({
  items,
}: {
  items: { project: Project; done: number; total: number; pct: number }[]
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Нет активных проектов.</p>
  }
  return (
    <div className="space-y-4">
      {items.map(({ project, done, total, pct }) => (
        <Link key={project.id} to={`/projects/${project.id}`} className="block group">
          <div className="flex items-center justify-between text-sm mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: project.color }}
              />
              <span className="font-medium group-hover:text-primary transition-colors truncate">
                {project.name}
              </span>
            </div>
            <span className="text-muted-foreground text-xs tabular-nums flex-shrink-0 ml-2">
              {done}/{total} · {pct}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, backgroundColor: project.color }}
            />
          </div>
        </Link>
      ))}
    </div>
  )
}

function RecentTasksList({
  tasks,
  projectMap,
}: {
  tasks: Task[]
  projectMap: Record<string, Project>
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Нет задач.</p>
  }
  return (
    <div className="space-y-1">
      {tasks.map((task) => {
        const project = projectMap[task.project_id]
        const badge = TASK_BADGE[task.status]
        const statusLabel = STATUS_CONFIG[task.status]?.label ?? task.status
        return (
          <Link
            key={task.id}
            to={`/projects/${task.project_id}`}
            className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent transition-colors"
          >
            {project && (
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: project.color }}
              />
            )}
            <span className="flex-1 text-sm font-medium truncate">{task.title}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', badge)}>
              {statusLabel}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function DeadlineCards({
  tasks,
  projectMap,
  today,
}: {
  tasks: Task[]
  projectMap: Record<string, Project>
  today: string
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">Нет предстоящих дедлайнов.</p>
  }

  const getDays = (dateStr: string) =>
    Math.ceil((new Date(dateStr).getTime() - new Date(today).getTime()) / 86_400_000)

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
      {tasks.map((task) => {
        const days = getDays(task.end_date!)
        const project = projectMap[task.project_id]
        const urgency =
          days <= 1
            ? 'border-red-300 bg-red-50 dark:bg-red-950/30'
            : days <= 3
              ? 'border-orange-300 bg-orange-50 dark:bg-orange-950/30'
              : 'border-border bg-card'
        return (
          <Link
            key={task.id}
            to={`/projects/${task.project_id}`}
            className={cn(
              'flex-shrink-0 w-52 rounded-xl border p-4 hover:shadow-md transition-shadow',
              urgency
            )}
          >
            {project && (
              <div className="flex items-center gap-1.5 mb-2">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: project.color }}
                />
                <span className="text-xs text-muted-foreground truncate">{project.name}</span>
              </div>
            )}
            <p className="text-sm font-medium truncate mb-2">{task.title}</p>
            <p className="text-xs font-semibold text-foreground">
              {days === 0 ? 'Сегодня' : days === 1 ? 'Завтра' : `через ${days} д.`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(task.end_date!).toLocaleDateString('ru')}
            </p>
          </Link>
        )
      })}
    </div>
  )
}

// ─── main component ────────────────────────────────────────────────────────────

export function Dashboard() {
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const { tasks, isLoading: tasksLoading } = useAllTasks()
  const createProject = useCreateProject()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    color: '#6366f1',
    start_date: '',
    end_date: '',
  })

  const today = new Date().toISOString().slice(0, 10)

  // ── metrics ──
  const activeProjects  = projects.filter((p) => p.status === 'active').length
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress').length
  const overdueTasks    = tasks.filter((t) => t.end_date && t.end_date < today && t.status !== 'done').length
  const doneTasks       = tasks.filter((t) => t.status === 'done').length

  // ── activity chart ──
  const activityData = useMemo(() => {
    const now = new Date()
    const months: { monthKey: string; label: string; count: number }[] = []
    for (let i = 8; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        monthKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleString('ru', { month: 'short' }),
        count: 0,
      })
    }
    tasks.forEach((t) => {
      const mk = t.created_at.slice(0, 7)
      const bucket = months.find((m) => m.monthKey === mk)
      if (bucket) bucket.count++
    })
    return months
  }, [tasks])

  // ── status stats ──
  const statusStats = useMemo(
    () =>
      Object.entries(STATUS_CONFIG).map(([key, cfg]) => ({
        key,
        label: cfg.label,
        color: cfg.color,
        count: tasks.filter((t) => t.status === key).length,
      })),
    [tasks]
  )

  // ── project progress ──
  const projectProgress = useMemo(() => {
    return projects
      .filter((p) => p.status === 'active')
      .slice(0, 5)
      .map((p) => {
        const pt = tasks.filter((t) => t.project_id === p.id)
        const done = pt.filter((t) => t.status === 'done').length
        const pct = pt.length > 0 ? Math.round((done / pt.length) * 100) : 0
        return { project: p, total: pt.length, done, pct }
      })
  }, [projects, tasks])

  // ── recent tasks ──
  const recentTasks = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 6),
    [tasks]
  )

  // ── upcoming deadlines ──
  const upcomingDeadlines = useMemo(
    () =>
      tasks
        .filter((t) => t.end_date && t.end_date >= today && t.status !== 'done')
        .sort((a, b) => a.end_date!.localeCompare(b.end_date!))
        .slice(0, 8),
    [tasks, today]
  )

  // ── project lookup map ──
  const projectMap = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects]
  )

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    await createProject.mutateAsync({
      ...form,
      start_date: form.start_date || undefined,
      end_date: form.end_date || undefined,
    })
    setDialogOpen(false)
    setForm({ name: '', description: '', color: '#6366f1', start_date: '', end_date: '' })
  }

  if (projectsLoading || tasksLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Загрузка...
      </div>
    )
  }

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Контроль ИТ‑проектов</h1>
          <p className="text-sm text-muted-foreground">
            {projects.length} проектов · {tasks.length} задач · обновлено сегодня
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-1" />
              Новый проект
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Создать проект</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1">
                <Label>Название</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="Название проекта"
                />
              </div>
              <div className="space-y-1">
                <Label>Описание</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Необязательно"
                />
              </div>
              <div className="space-y-1">
                <Label>Цвет</Label>
                <div className="flex gap-2">
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        form.color === c ? 'border-foreground scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Начало</Label>
                  <Input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Дедлайн</Label>
                  <Input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createProject.isPending}>
                {createProject.isPending ? 'Создание...' : 'Создать проект'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Активные проекты"
          value={activeProjects}
          icon={<FolderOpen className="w-4 h-4" />}
          iconColor="text-blue-500"
          bgColor="bg-blue-50 dark:bg-blue-950/30"
        />
        <MetricCard
          label="В работе"
          value={inProgressTasks}
          icon={<Clock className="w-4 h-4" />}
          iconColor="text-purple-500"
          bgColor="bg-purple-50 dark:bg-purple-950/30"
        />
        <MetricCard
          label="Просрочено"
          value={overdueTasks}
          icon={<AlertTriangle className="w-4 h-4" />}
          iconColor="text-red-500"
          bgColor="bg-red-50 dark:bg-red-950/30"
        />
        <MetricCard
          label="Выполнено"
          value={doneTasks}
          icon={<CheckCircle2 className="w-4 h-4" />}
          iconColor="text-green-500"
          bgColor="bg-green-50 dark:bg-green-950/30"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard title="Динамика задач за 9 месяцев">
            <ActivityChart data={activityData} />
          </SectionCard>
          <SectionCard
            title="Последние задачи"
            action={
              <Link to="/analytics" className="text-xs text-primary hover:underline">
                Аналитика →
              </Link>
            }
          >
            <RecentTasksList tasks={recentTasks} projectMap={projectMap} />
          </SectionCard>
        </div>
        <div className="space-y-6">
          <SectionCard title="Статусы задач">
            <StatusList items={statusStats} total={tasks.length} />
          </SectionCard>
          <SectionCard
            title="Активные проекты"
            action={
              <Link to="/" className="text-xs text-primary hover:underline">
                Все проекты →
              </Link>
            }
          >
            <ProjectProgressList items={projectProgress} />
          </SectionCard>
          <SectionCard title="Ближайшие дедлайны">
            <DeadlineCards tasks={upcomingDeadlines} projectMap={projectMap} today={today} />
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
