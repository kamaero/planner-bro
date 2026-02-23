import { useState, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useProjects, useCreateProject, useAllTasks, useEscalations } from '@/hooks/useProjects'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ProjectCard } from '@/components/ProjectCard/ProjectCard'
import { api } from '@/api/client'
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

const PROJECT_TEMPLATES: Record<string, Array<{ title: string; priority: string; daysOffset: number }>> = {
  blank: [],
  launch: [
    { title: 'Сбор требований', priority: 'high', daysOffset: 2 },
    { title: 'План работ и оценка', priority: 'high', daysOffset: 5 },
    { title: 'Риски и план коммуникаций', priority: 'medium', daysOffset: 7 },
  ],
  support: [
    { title: 'Мониторинг SLA', priority: 'high', daysOffset: 1 },
    { title: 'Обзор инцидентов', priority: 'medium', daysOffset: 3 },
    { title: 'План улучшений', priority: 'medium', daysOffset: 7 },
  ],
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
  onClick,
  active,
}: {
  label: string
  value: number
  icon: React.ReactNode
  iconColor: string
  bgColor: string
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'rounded-xl border bg-card p-5 text-left transition-shadow hover:shadow-md cursor-pointer',
        active ? 'ring-2 ring-primary/40' : undefined
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', bgColor)}>
          <span className={iconColor}>{icon}</span>
        </div>
      </div>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
    </button>
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
  const { data: escalations = [] } = useEscalations()
  const createProject = useCreateProject()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    color: '#6366f1',
    template: 'blank',
    start_date: '',
    end_date: '',
  })
  const [focus, setFocus] = useState<'active' | 'in_progress' | 'overdue' | 'done'>('active')
  const [search, setSearch] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const focusSectionRef = useRef<HTMLElement | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  const handleFocus = (key: 'active' | 'in_progress' | 'overdue' | 'done') => {
    setFocus(key)
    setSearch('')
    focusSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tasksByProject = useMemo(() => {
    const map: Record<string, Task[]> = {}
    tasks.forEach((task) => {
      if (!map[task.project_id]) {
        map[task.project_id] = []
      }
      map[task.project_id].push(task)
    })
    return map
  }, [tasks])

  const activeProjectsList = useMemo(
    () =>
      projects.filter(
        (p) => p.status !== 'completed' && (!p.end_date || p.end_date >= today)
      ),
    [projects, today]
  )
  const overdueProjectsList = useMemo(
    () =>
      projects.filter(
        (p) => p.status !== 'completed' && p.end_date && p.end_date < today
      ),
    [projects, today]
  )
  const doneProjectsList = useMemo(
    () => projects.filter((p) => p.status === 'completed'),
    [projects]
  )
  const inProgressProjectsList = useMemo(
    () =>
      projects.filter((p) => {
        const pt = tasksByProject[p.id] ?? []
        return pt.some((t) => t.status === 'in_progress' || t.status === 'review')
      }),
    [projects, tasksByProject]
  )

  const activeProjects = activeProjectsList.length
  const inProgressProjects = inProgressProjectsList.length
  const overdueProjects = overdueProjectsList.length
  const doneProjects = doneProjectsList.length

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
    return [...activeProjectsList]
      .sort((a, b) => {
        if (!a.end_date && !b.end_date) return b.updated_at.localeCompare(a.updated_at)
        if (!a.end_date) return 1
        if (!b.end_date) return -1
        return a.end_date.localeCompare(b.end_date)
      })
      .slice(0, 5)
      .map((p) => {
        const pt = tasks.filter((t) => t.project_id === p.id)
        const done = pt.filter((t) => t.status === 'done').length
        const pct = pt.length > 0 ? Math.round((done / pt.length) * 100) : 0
        return { project: p, total: pt.length, done, pct }
      })
  }, [activeProjectsList, tasks])

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
  const taskMap = useMemo(
    () => Object.fromEntries(tasks.map((t) => [t.id, t])),
    [tasks]
  )
  const blockedTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.parent_task_id && t.status !== 'done')
        .filter((t) => {
          const dependency = taskMap[t.parent_task_id!]
          return dependency && dependency.status !== 'done'
        }),
    [tasks, taskMap]
  )
  const blockedByProject = useMemo<Array<{ project: Project; count: number }>>(() => {
    const acc: Record<string, number> = {}
    blockedTasks.forEach((task) => {
      acc[task.project_id] = (acc[task.project_id] ?? 0) + 1
    })
    return Object.entries(acc)
      .map(([projectId, count]) => ({ project: projectMap[projectId], count }))
      .filter((item): item is { project: Project; count: number } => Boolean(item.project))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  }, [blockedTasks, projectMap])
  const escalationSlaOverdue = useMemo(() => {
    const now = Date.now()
    return escalations.filter((task) => {
      if (task.escalation_first_response_at) return false
      if (task.escalation_overdue_at) return true
      if (!task.escalation_due_at) return false
      return new Date(task.escalation_due_at).getTime() < now
    })
  }, [escalations])

  const focusTitles: Record<typeof focus, string> = {
    active: 'Активные проекты',
    in_progress: 'В работе',
    overdue: 'Просрочено',
    done: 'Выполнено',
  }

  const focusProjects = useMemo(() => {
    switch (focus) {
      case 'active':
        return activeProjectsList
      case 'in_progress':
        return inProgressProjectsList
      case 'overdue':
        return overdueProjectsList
      case 'done':
        return doneProjectsList
      default:
        return activeProjectsList
    }
  }, [
    focus,
    activeProjectsList,
    inProgressProjectsList,
    overdueProjectsList,
    doneProjectsList,
  ])

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return focusProjects
    return focusProjects.filter((p) => {
      const name = p.name.toLowerCase()
      const desc = (p.description ?? '').toLowerCase()
      return name.includes(q) || desc.includes(q)
    })
  }, [focusProjects, search])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const created = await createProject.mutateAsync({
      ...form,
      status: 'active',
      start_date: form.start_date || undefined,
      end_date: form.end_date || undefined,
    })
    const templateTasks = PROJECT_TEMPLATES[form.template] ?? []
    await Promise.all(
      templateTasks.map((t) => {
        const end = new Date()
        end.setDate(end.getDate() + t.daysOffset)
        return api.createTask(created.id, {
          title: t.title,
          priority: t.priority,
          end_date: end.toISOString().slice(0, 10),
        })
      })
    )
    setDialogOpen(false)
    setForm({ name: '', description: '', color: '#6366f1', template: 'blank', start_date: '', end_date: '' })
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
              <div className="space-y-1">
                <Label>Шаблон</Label>
                <select
                  value={form.template}
                  onChange={(e) => setForm((f) => ({ ...f, template: e.target.value }))}
                  className="w-full border rounded px-2 py-2 bg-background text-sm"
                >
                  <option value="blank">Пустой проект</option>
                  <option value="launch">Запуск проекта</option>
                  <option value="support">Сопровождение</option>
                </select>
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
          onClick={() => handleFocus('active')}
          active={focus === 'active'}
        />
        <MetricCard
          label="В работе"
          value={inProgressProjects}
          icon={<Clock className="w-4 h-4" />}
          iconColor="text-purple-500"
          bgColor="bg-purple-50 dark:bg-purple-950/30"
          onClick={() => handleFocus('in_progress')}
          active={focus === 'in_progress'}
        />
        <MetricCard
          label="Просрочено"
          value={overdueProjects}
          icon={<AlertTriangle className="w-4 h-4" />}
          iconColor="text-red-500"
          bgColor="bg-red-50 dark:bg-red-950/30"
          onClick={() => handleFocus('overdue')}
          active={focus === 'overdue'}
        />
        <MetricCard
          label="Выполнено"
          value={doneProjects}
          icon={<CheckCircle2 className="w-4 h-4" />}
          iconColor="text-green-500"
          bgColor="bg-green-50 dark:bg-green-950/30"
          onClick={() => handleFocus('done')}
          active={focus === 'done'}
        />
      </div>

      <section ref={focusSectionRef}>
      <SectionCard
        title={focusTitles[focus]}
        action={
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по проектам"
              className="h-8 text-xs"
            />
          </div>
        }
      >
        <div ref={listRef} />
        {filteredProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3">
            Нет проектов для выбранного фильтра.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </SectionCard>
      </section>

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
          <SectionCard title="Эскалации на меня">
            {escalations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Новых эскалаций нет.</p>
            ) : (
              <div className="space-y-2">
                {escalations.slice(0, 8).map((task) => (
                  <Link
                    key={task.id}
                    to={`/projects/${task.project_id}`}
                    className="block rounded-lg border p-3 hover:bg-accent transition-colors"
                  >
                    <p className="text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.escalation_for || 'Требуется решение руководителя'}
                    </p>
                    {task.escalation_overdue_at ? (
                      <p className="text-xs text-red-700 mt-1">SLA просрочен</p>
                    ) : task.escalation_due_at ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        SLA до {new Date(task.escalation_due_at).toLocaleString('ru')}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
        <div className="space-y-6">
          <SectionCard title="Узкие места: зависимости и блокеры">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Блокирующие зависимости</p>
                  <p className="text-xl font-semibold">{blockedTasks.length}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Эскалации с просроченным SLA</p>
                  <p className="text-xl font-semibold text-red-700">{escalationSlaOverdue.length}</p>
                </div>
              </div>
              {blockedTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Критичных блокеров по зависимостям не найдено.</p>
              ) : (
                <div className="space-y-2">
                  {blockedTasks.slice(0, 6).map((task) => {
                    const dependency = taskMap[task.parent_task_id!]
                    return (
                      <Link
                        key={task.id}
                        to={`/projects/${task.project_id}`}
                        className="block rounded-lg border p-3 hover:bg-accent transition-colors"
                      >
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          Блокер: {dependency?.title ?? 'Зависимость не найдена'}
                        </p>
                      </Link>
                    )
                  })}
                </div>
              )}
              {blockedByProject.length > 0 && (
                <div className="pt-1">
                  <p className="text-xs text-muted-foreground mb-2">Проекты с наибольшим числом блокеров</p>
                  <div className="space-y-1">
                    {blockedByProject.map((item) => (
                      <div key={item.project.id} className="flex items-center justify-between text-sm">
                        <span className="truncate">{item.project.name}</span>
                        <span className="font-semibold">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
          <SectionCard title="Статусы задач">
            <StatusList items={statusStats} total={tasks.length} />
          </SectionCard>
          <SectionCard
            title="Активные проекты"
            action={
              <button
                type="button"
                onClick={() => handleFocus('active')}
                className="text-xs text-primary hover:underline"
              >
                Открыть список →
              </button>
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
