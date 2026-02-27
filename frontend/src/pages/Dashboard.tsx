import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useCreateProject, useDepartmentDashboard, useProjects, useAllTasks, useEscalations, useUpdateProject } from '@/hooks/useProjects'
import { api } from '@/api/client'
import { Plus, FolderOpen, Clock, AlertTriangle, CheckCircle2, Building2, Users2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useAuthStore } from '@/store/authStore'
import type { Department, Project, Task } from '@/types'

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ')
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

const PROJECT_STATUS_LABEL: Record<string, string> = {
  planning: 'Планирование',
  active: 'Активный',
  on_hold: 'На паузе',
  completed: 'Завершен',
}

const TASK_STATUS_LABEL: Record<string, string> = {
  planning: 'Планирование',
  todo: 'К выполнению',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Выполнено',
}

function SectionCard({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function MetricCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className={cn('rounded-lg p-2', tone)}>{icon}</div>
      </div>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function formatDate(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru')
}

function parseDateOnly(value?: string): Date | null {
  if (!value) return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10) - 1
  const day = Number.parseInt(match[3], 10)
  return new Date(year, month, day, 12, 0, 0, 0)
}

function daysUntil(dateValue?: string): number | null {
  const target = parseDateOnly(dateValue)
  if (!target) return null
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0)
  return Math.round((target.getTime() - startToday.getTime()) / (1000 * 60 * 60 * 24))
}

function deadlinePulseClass(days: number | null): string {
  if (days === null) return ''
  if (days >= 0 && days <= 7) return 'border-red-400 bg-red-50/80 shadow-[0_0_10px_rgba(239,68,68,0.35)] animate-pulse'
  if (days >= 10 && days <= 14) return 'border-orange-400 bg-orange-50/80 shadow-[0_0_12px_rgba(249,115,22,0.42)] animate-pulse'
  if (days > 14 && days <= 20) return 'border-emerald-400 bg-emerald-50/80 shadow-[0_0_12px_rgba(16,185,129,0.38)] animate-pulse'
  return ''
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return `rgba(99,102,241,${alpha})`
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function Dashboard() {
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const { tasks, isLoading: tasksLoading } = useAllTasks()
  const { data: escalations = [] } = useEscalations()
  const { data: dashboardData, isLoading: departmentsLoading } = useDepartmentDashboard()
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: api.listDepartments,
  })

  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const currentUser = useAuthStore((s) => s.user)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [createError, setCreateError] = useState('')
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [selectedDepartmentTab, setSelectedDepartmentTab] = useState<string>('all')
  const [projectSearch, setProjectSearch] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [escalationBlinkEnabled, setEscalationBlinkEnabled] = useState(true)
  const [assignProject, setAssignProject] = useState<Project | null>(null)
  const [assignDepartmentIds, setAssignDepartmentIds] = useState<string[]>([])
  const [form, setForm] = useState({
    name: '',
    description: '',
    color: '#6366f1',
    template: 'blank',
    priority: 'medium',
    control_ski: false,
    launch_basis_text: '',
    start_date: '',
    end_date: '',
    department_ids: [] as string[],
  })

  const canManageDepartmentLinks = currentUser?.role === 'admin' || currentUser?.role === 'manager' || !!currentUser?.can_manage_team

  const today = new Date().toISOString().slice(0, 10)
  const sevenDaysAgo = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString()
  }, [])

  const departmentTabs = useMemo(
    () => dashboardData?.departments ?? [],
    [dashboardData]
  )

  useEffect(() => {
    if (selectedDepartmentTab === 'all') return
    const exists = departmentTabs.some((dep) => dep.department_id === selectedDepartmentTab)
    if (!exists) setSelectedDepartmentTab('all')
  }, [departmentTabs, selectedDepartmentTab])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('dashboard_escalation_blink')
      if (raw === 'off') setEscalationBlinkEnabled(false)
    } catch {
      // ignore storage errors in restricted environments
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem('dashboard_escalation_blink', escalationBlinkEnabled ? 'on' : 'off')
    } catch {
      // ignore storage errors in restricted environments
    }
  }, [escalationBlinkEnabled])

  const myProjectIds = useMemo(() => {
    if (!currentUser?.id) return new Set<string>()
    const ids = new Set<string>()
    for (const p of projects) {
      if (p.owner_id === currentUser.id) ids.add(p.id)
    }
    for (const t of tasks) {
      const assignedIds = t.assignee_ids ?? []
      if (t.project_id && (t.created_by_id === currentUser.id || t.assigned_to_id === currentUser.id || assignedIds.includes(currentUser.id))) {
        ids.add(t.project_id)
      }
    }
    return ids
  }, [projects, tasks, currentUser?.id])

  const myTasks = useMemo(() => {
    if (!currentUser?.id) return [] as Task[]
    return tasks
      .filter((t) => {
        const assignedIds = t.assignee_ids ?? []
        return t.created_by_id === currentUser.id || t.assigned_to_id === currentUser.id || assignedIds.includes(currentUser.id)
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 8)
  }, [tasks, currentUser?.id])

  const projectsForSelectedTab = useMemo(() => {
    const source =
      selectedDepartmentTab === 'all'
        ? projects
        : departmentTabs.find((dep) => dep.department_id === selectedDepartmentTab)?.projects ?? []
    const mineFiltered = onlyMine ? source.filter((project) => myProjectIds.has(project.id)) : source
    const q = projectSearch.trim().toLowerCase()
    if (!q) return mineFiltered
    return mineFiltered.filter((project) => {
      const hay = `${project.name} ${project.description ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [projects, departmentTabs, selectedDepartmentTab, projectSearch, onlyMine, myProjectIds])

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status !== 'completed' && (!p.end_date || p.end_date >= today)).length,
    [projects, today]
  )
  const inProgressProjects = useMemo(
    () => projects.filter((p) => tasks.some((t) => t.project_id === p.id && (t.status === 'in_progress' || t.status === 'review'))).length,
    [projects, tasks]
  )
  const overdueProjects = useMemo(
    () => projects.filter((p) => p.status !== 'completed' && !!p.end_date && p.end_date < today).length,
    [projects, today]
  )
  const doneProjects = useMemo(() => projects.filter((p) => p.status === 'completed').length, [projects])

  const weekSignals = useMemo(() => {
    const created = tasks.filter((t) => t.created_at >= sevenDaysAgo).length
    const updated = tasks.filter((t) => t.updated_at >= sevenDaysAgo).length
    const completed = tasks.filter((t) => t.status === 'done' && t.updated_at >= sevenDaysAgo).length
    const stale = tasks.filter((t) => t.status !== 'done' && t.updated_at < sevenDaysAgo).length
    return { created, updated, completed, stale }
  }, [tasks, sevenDaysAgo])

  const statusStats = useMemo(() => {
    const counts: Record<string, number> = { planning: 0, todo: 0, in_progress: 0, review: 0, done: 0 }
    tasks.forEach((task) => {
      counts[task.status] = (counts[task.status] ?? 0) + 1
    })
    return counts
  }, [tasks])

  const projectMap = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects])

  const recentTasks = useMemo(
    () => [...tasks].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8),
    [tasks]
  )

  const skiControlTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.control_ski && t.status !== 'done')
        .sort((a, b) => {
          const ad = daysUntil(a.end_date)
          const bd = daysUntil(b.end_date)
          if (ad === null && bd === null) return 0
          if (ad === null) return 1
          if (bd === null) return -1
          return ad - bd
        })
        .slice(0, 6),
    [tasks]
  )

  const upcomingDeadlines = useMemo(
    () =>
      tasks
        .filter((t) => {
          if (!t.end_date || t.status === 'done') return false
          const days = daysUntil(t.end_date)
          return days !== null && days >= 0 && days <= 20
        })
        .sort((a, b) => {
          const ad = daysUntil(a.end_date) ?? Number.MAX_SAFE_INTEGER
          const bd = daysUntil(b.end_date) ?? Number.MAX_SAFE_INTEGER
          return ad - bd
        })
        .slice(0, 8),
    [tasks]
  )

  const departmentNameById = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d.name])),
    [departments]
  )

  const escalationPulse = escalations.length > 0 && escalationBlinkEnabled
  const projectProgressById = useMemo(() => {
    const grouped = new Map<string, { sum: number; count: number }>()
    tasks.forEach((task) => {
      const current = grouped.get(task.project_id) ?? { sum: 0, count: 0 }
      current.sum += task.progress_percent ?? 0
      current.count += 1
      grouped.set(task.project_id, current)
    })
    const result: Record<string, number> = {}
    grouped.forEach((value, key) => {
      result[key] = value.count > 0 ? Math.round(value.sum / value.count) : 0
    })
    return result
  }, [tasks])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    try {
      const created = await createProject.mutateAsync({
        ...form,
        status: 'active',
        priority: form.control_ski ? 'critical' : form.priority,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
        launch_basis_text: form.launch_basis_text?.trim() || undefined,
        department_ids: form.department_ids,
      })

      // Close dialog immediately once project exists.
      setDialogOpen(false)
      setForm({
        name: '',
        description: '',
        color: '#6366f1',
        template: 'blank',
        priority: 'medium',
        control_ski: false,
        launch_basis_text: '',
        start_date: '',
        end_date: '',
        department_ids: [],
      })

      // Template tasks are best-effort and must not block UI.
      const templateTasks = PROJECT_TEMPLATES[form.template] ?? []
      await Promise.allSettled(
        templateTasks.map((taskTemplate) => {
          const end = new Date()
          end.setDate(end.getDate() + taskTemplate.daysOffset)
          return api.createTask(created.id, {
            title: taskTemplate.title,
            priority: taskTemplate.priority,
            end_date: end.toISOString().slice(0, 10),
          })
        })
      )
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setCreateError(typeof detail === 'string' ? detail : 'Не удалось создать проект')
    }
  }

  const openAssignDialog = (project: Project) => {
    setAssignProject(project)
    setAssignDepartmentIds(project.department_ids ?? [])
    setAssignDialogOpen(true)
  }

  const saveProjectDepartments = async () => {
    if (!assignProject) return
    await updateProject.mutateAsync({
      projectId: assignProject.id,
      data: { department_ids: assignDepartmentIds },
    })
    setAssignDialogOpen(false)
  }

  if (projectsLoading || tasksLoading || departmentsLoading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">Загрузка...</div>
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-4 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Дэшборд IT</h1>
          <p className="text-sm text-muted-foreground">{projects.length} проектов · {tasks.length} задач</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-1 h-4 w-4" />
              Новый проект
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Создать проект</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-3">
              {createError && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {createError}
                </div>
              )}
              <div className="space-y-1">
                <Label>Название</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="space-y-1">
                <Label>Описание</Label>
                <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Цвет</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="h-9 w-14 cursor-pointer p-1"
                  />
                  <Input
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    placeholder="#RRGGBB"
                    className="h-9 w-32 font-mono text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Шаблон</Label>
                  <select
                    value={form.template}
                    onChange={(e) => setForm((f) => ({ ...f, template: e.target.value }))}
                    className="w-full rounded border bg-background px-2 py-2 text-sm"
                  >
                    <option value="blank">Пустой</option>
                    <option value="launch">Запуск</option>
                    <option value="support">Сопровождение</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Приоритет</Label>
                  <select
                    value={form.control_ski ? 'critical' : form.priority}
                    onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                    className="w-full rounded border bg-background px-2 py-2 text-sm"
                    disabled={form.control_ski}
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.control_ski}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      control_ski: e.target.checked,
                      priority: e.target.checked ? 'critical' : f.priority,
                    }))
                  }
                />
                Контроль СКИ
              </label>
              <div className="space-y-1">
                <Label>Отделы проекта</Label>
                <div className="max-h-28 space-y-1 overflow-auto rounded border p-2 text-sm">
                  {departments.map((dep) => (
                    <label key={dep.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.department_ids.includes(dep.id)}
                        onChange={(e) => {
                          setForm((f) => ({
                            ...f,
                            department_ids: e.target.checked
                              ? [...f.department_ids, dep.id]
                              : f.department_ids.filter((id) => id !== dep.id),
                          }))
                        }}
                      />
                      {dep.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Начало</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Дедлайн</Label>
                  <Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createProject.isPending}>
                {createProject.isPending ? 'Создаю проект...' : 'Создать'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Активные" value={activeProjects} icon={<FolderOpen className="h-4 w-4 text-blue-600" />} tone="bg-blue-50" />
        <MetricCard label="В работе" value={inProgressProjects} icon={<Clock className="h-4 w-4 text-indigo-600" />} tone="bg-indigo-50" />
        <MetricCard label="Просрочено" value={overdueProjects} icon={<AlertTriangle className="h-4 w-4 text-red-600" />} tone="bg-red-50" />
        <MetricCard label="Завершено" value={doneProjects} icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} tone="bg-emerald-50" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard
          title="ИТ проекты по отделам"
          className="xl:col-span-7"
          action={
            <Input value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} placeholder="Поиск проекта" className="h-8 w-48 text-xs" />
          }
        >
          <div className="mb-3">
            <button
              type="button"
              onClick={() => setOnlyMine((v) => !v)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-all animate-pulse',
                onlyMine
                  ? 'border-blue-600 bg-blue-600/15 text-blue-700 shadow-[0_0_12px_rgba(37,99,235,0.45)]'
                  : 'border-blue-400/80 bg-blue-500/10 text-blue-700 shadow-[0_0_10px_rgba(59,130,246,0.3)]'
              )}
            >
              Мои проекты и задачи
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedDepartmentTab('all')}
              className={cn('rounded-md border px-2 py-1 text-xs', selectedDepartmentTab === 'all' ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}
            >
              Все отделы
            </button>
            {departmentTabs.map((dep) => (
              <button
                key={dep.department_id}
                type="button"
                onClick={() => setSelectedDepartmentTab(dep.department_id)}
                className={cn('rounded-md border px-2 py-1 text-xs', selectedDepartmentTab === dep.department_id ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}
              >
                {dep.department_name} ({dep.projects.length})
              </button>
            ))}
          </div>

          <div className="max-h-[500px] space-y-1.5 overflow-auto pr-1">
            {projectsForSelectedTab.length === 0 && <p className="text-sm text-muted-foreground">Проектов не найдено.</p>}
            {projectsForSelectedTab.map((project) => (
              <div
                key={project.id}
                className={cn(
                  'rounded-lg border p-2.5 transition-all',
                  (() => {
                    const d = daysUntil(project.end_date)
                    if (d !== null && d >= 3 && d <= 5) {
                      return 'border-red-500/90 shadow-[0_0_14px_rgba(239,68,68,0.55)]'
                    }
                    if (d !== null && d >= 7 && d <= 10) {
                      return 'border-orange-500/90 shadow-[0_0_14px_rgba(249,115,22,0.45)]'
                    }
                    return ''
                  })()
                )}
                style={{
                  backgroundImage: `linear-gradient(90deg, ${hexToRgba(project.color ?? '#6366f1', 0.18)} 0%, ${hexToRgba(project.color ?? '#6366f1', 0.18)} ${projectProgressById[project.id] ?? 0}%, rgba(255,255,255,0) ${projectProgressById[project.id] ?? 0}%)`,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/projects/${project.id}`} className="truncate text-sm font-semibold hover:text-primary">
                      {project.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {PROJECT_STATUS_LABEL[project.status] ?? project.status} · исполнение: {projectProgressById[project.id] ?? 0}% · дедлайн: {formatDate(project.end_date)} · владелец: {project.owner?.name}
                    </p>
                    {!!project.department_ids?.length && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Отделы: {project.department_ids.map((id) => departmentNameById[id] ?? id).join(', ')}
                      </p>
                    )}
                  </div>
                  {canManageDepartmentLinks && (
                    <Button size="sm" variant="outline" onClick={() => openAssignDialog(project)}>
                      <Building2 className="mr-1 h-3.5 w-3.5" />
                      Отделы
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {onlyMine && (
            <div className="mt-3 border-t pt-3">
              <p className="mb-2 text-xs text-muted-foreground">Мои задачи</p>
              <div className="max-h-44 space-y-1 overflow-auto pr-1">
                {myTasks.length === 0 && <p className="text-xs text-muted-foreground">Личных задач не найдено.</p>}
                {myTasks.map((task) => (
                  <Link key={task.id} to={`/projects/${task.project_id}?task=${task.id}`} className="block rounded border px-2 py-1.5 text-xs hover:bg-accent">
                    <p className="truncate font-medium">{task.title}</p>
                    <p className="text-muted-foreground">
                      {TASK_STATUS_LABEL[task.status] ?? task.status} · дедлайн: {formatDate(task.end_date)}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Статусы и дедлайны" className="xl:col-span-3">
          <div className="space-y-3">
            {Object.entries(statusStats).map(([key, value]) => (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{TASK_STATUS_LABEL[key]}</span>
                  <span className="font-semibold tabular-nums">{value}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${tasks.length ? (value / tasks.length) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t pt-3">
            <p className="mb-2 text-xs text-muted-foreground">Ближайшие дедлайны</p>
            <div className="space-y-2">
              {upcomingDeadlines.length === 0 && <p className="text-xs text-muted-foreground">Нет предстоящих дедлайнов</p>}
              {upcomingDeadlines.map((task) => (
                <Link
                  key={task.id}
                  to={`/projects/${task.project_id}`}
                  className={cn(
                    'block rounded border px-2 py-1.5 text-xs transition-colors',
                    deadlinePulseClass(daysUntil(task.end_date)) || 'hover:bg-accent'
                  )}
                >
                  <p className="truncate font-medium">{task.title}</p>
                  <p className="text-muted-foreground">
                    {projectMap[task.project_id]?.name ?? 'Проект'} · {formatDate(task.end_date)}
                    {(() => {
                      const d = daysUntil(task.end_date)
                      if (d === null) return ''
                      return d >= 0 ? ` · ${d} дн.` : ' · просрочено'
                    })()}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Сигналы контроля" className="xl:col-span-2">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded border p-2">
              <p className="text-[11px] text-muted-foreground">Создано 7д</p>
              <p className="text-lg font-semibold">{weekSignals.created}</p>
            </div>
            <div className="rounded border p-2">
              <p className="text-[11px] text-muted-foreground">Обновлено 7д</p>
              <p className="text-lg font-semibold">{weekSignals.updated}</p>
            </div>
            <div className="rounded border p-2">
              <p className="text-[11px] text-muted-foreground">Завершено 7д</p>
              <p className="text-lg font-semibold text-emerald-700">{weekSignals.completed}</p>
            </div>
            <div className="rounded border p-2">
              <p className="text-[11px] text-muted-foreground">Без апдейта 7д+</p>
              <p className="text-lg font-semibold text-amber-700">{weekSignals.stale}</p>
            </div>
          </div>
          <div className="mt-3 rounded border p-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Эскалации на мне</span>
              <span className="font-semibold">{escalations.length}</span>
            </div>
            <div className="mt-2 border-t pt-2">
              <p className="mb-1 text-muted-foreground">СКИ контроль ({skiControlTasks.length})</p>
              <div className="max-h-32 space-y-1 overflow-auto pr-1">
                {skiControlTasks.length === 0 && <p className="text-[11px] text-muted-foreground">Нет активных задач СКИ</p>}
                {skiControlTasks.map((task) => {
                  const d = daysUntil(task.end_date)
                  return (
                    <Link
                      key={task.id}
                      to={`/projects/${task.project_id}?task=${task.id}`}
                      className={cn('block rounded border px-2 py-1 text-[11px] transition-colors', deadlinePulseClass(d) || 'hover:bg-accent')}
                    >
                      <p className="truncate font-medium">{task.title}</p>
                      <p className="text-muted-foreground">
                        {formatDate(task.end_date)}
                        {d === null ? ' · без дедлайна' : d >= 0 ? ` · ${d} дн.` : ' · просрочено'}
                      </p>
                    </Link>
                  )
                })}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Последние обновленные задачи" action={<Users2 className="h-4 w-4 text-muted-foreground" />}>
          <div className="max-h-64 space-y-1 overflow-auto">
            {recentTasks.map((task: Task) => (
              <Link key={task.id} to={`/projects/${task.project_id}`} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-accent">
                <span className="truncate">{task.title}</span>
                <span className="ml-3 shrink-0 text-xs text-muted-foreground">{TASK_STATUS_LABEL[task.status]}</span>
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Эскалации"
          className={cn(escalationPulse && 'border-red-500/90 shadow-[0_0_18px_rgba(239,68,68,0.55)] animate-pulse')}
          action={
            <div className="flex items-center gap-2">
              {escalations.length > 0 && (
                <button
                  type="button"
                  onClick={() => setEscalationBlinkEnabled((v) => !v)}
                  className={cn(
                    'rounded border px-2 py-0.5 text-[11px]',
                    escalationBlinkEnabled ? 'border-red-400 text-red-600' : 'text-muted-foreground'
                  )}
                >
                  {escalationBlinkEnabled ? 'Мигание: Вкл' : 'Мигание: Выкл'}
                </button>
              )}
              <Link to="/analytics" className="text-xs text-primary hover:underline">
                Аналитика →
              </Link>
            </div>
          }
        >
          <div className="max-h-64 space-y-2 overflow-auto">
            {escalations.length === 0 && <p className="text-sm text-muted-foreground">Новых эскалаций нет.</p>}
            {escalations.slice(0, 8).map((task) => (
              <Link key={task.id} to={`/projects/${task.project_id}`} className="block rounded border p-2 text-sm hover:bg-accent">
                <p className="truncate font-medium">{task.title}</p>
                <p className="text-xs text-muted-foreground">{task.escalation_for || 'Требуется решение руководителя'}</p>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Назначить отделы проекту</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{assignProject?.name}</p>
          <div className="max-h-56 space-y-2 overflow-auto rounded border p-2 text-sm">
            {departments.map((dep) => (
              <label key={dep.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={assignDepartmentIds.includes(dep.id)}
                  onChange={(e) => {
                    setAssignDepartmentIds((prev) =>
                      e.target.checked ? [...prev, dep.id] : prev.filter((id) => id !== dep.id)
                    )
                  }}
                />
                {dep.name}
              </label>
            ))}
          </div>
          <Button onClick={saveProjectDepartments} disabled={updateProject.isPending}>
            {updateProject.isPending ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
