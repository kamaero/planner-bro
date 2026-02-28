import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useCreateProject, useCreateTask, useDepartmentDashboard, useProjects, useAllTasks, useEscalations, useUpdateProject } from '@/hooks/useProjects'
import { api } from '@/api/client'
import { Plus, Building2, Users2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useAuthStore } from '@/store/authStore'
import type { Department, Project, Task, User, SystemActivityLog } from '@/types'

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
  tz: 'ТЗ',
  active: 'Активный',
  testing: 'Тестирование',
  on_hold: 'На паузе',
  completed: 'Завершен',
}

const TASK_STATUS_LABEL: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  todo: 'К выполнению',
  in_progress: 'В работе',
  testing: 'Тестирование',
  review: 'На проверке',
  done: 'Выполнено',
}

const IT_QUOTES = [
  'Любой баг становится фичей, если его не чинить достаточно долго.',
  'Работает в проде? Значит, трогать это нужно очень аккуратно.',
  'Нет ничего более постоянного, чем временное IT-решение.',
  'Дедлайн был вчера, но зато архитектура сегодня красивая.',
  'Если всё упало, начни с перезапуска. Потом сделай вид, что так и было.',
  'Логи не врут. Просто иногда говорят намеками.',
  'Код без комментариев как квест: интересно, но больно.',
  'Тесты пишут не для QA, а для будущего себя в пятницу вечером.',
  'Автоматизируй рутину: у человека есть дела поважнее паники.',
  'Главное правило релиза: сначала бэкап, потом смелость.',
]

function SectionCard({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('h-full rounded-xl border bg-card p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function formatDate(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru')
}

function humanizeTaskUpdateTime(value?: string): string {
  if (!value) return 'нет данных'
  const updatedAt = new Date(value)
  if (Number.isNaN(updatedAt.getTime())) return 'нет данных'

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const updatedDayStart = new Date(updatedAt.getFullYear(), updatedAt.getMonth(), updatedAt.getDate())
  const diffDays = Math.floor((todayStart.getTime() - updatedDayStart.getTime()) / (1000 * 60 * 60 * 24))

  const timePart = updatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (diffDays <= 0) return `сегодня, ${timePart}`
  if (diffDays === 1) return `вчера, ${timePart}`
  if (diffDays === 2) return `позавчера, ${timePart}`
  if (diffDays <= 7) return `на прошлой неделе (${updatedAt.toLocaleDateString('ru-RU')})`
  return updatedAt.toLocaleDateString('ru-RU')
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
  if (days >= 0 && days <= 7) return 'border-red-400 shadow-[0_0_10px_rgba(239,68,68,0.35)] animate-pulse'
  if (days >= 10 && days <= 14) return 'border-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.42)] animate-pulse'
  if (days > 14 && days <= 20) return 'border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.38)] animate-pulse'
  return ''
}

function myTaskUrgencyClass(days: number | null): string {
  if (days === null) return 'hover:bg-accent'
  if (days < 0) return 'border-red-600 shadow-[0_0_14px_rgba(220,38,38,0.55)] animate-pulse'
  if (days <= 1) return 'border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse'
  if (days <= 3) return 'border-red-400 shadow-[0_0_10px_rgba(248,113,113,0.42)] animate-pulse'
  if (days <= 7) return 'border-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.35)]'
  return 'hover:bg-accent'
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
  const URGENT_INBOX_PROJECT_NAME = 'Срочные задачи (вне проектов)'
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const { tasks, isLoading: tasksLoading } = useAllTasks()
  const { data: escalations = [] } = useEscalations()
  const { data: dashboardData, isLoading: departmentsLoading } = useDepartmentDashboard()
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: api.listDepartments,
  })

  const createProject = useCreateProject()
  const createTask = useCreateTask()
  const updateProject = useUpdateProject()
  const currentUser = useAuthStore((s) => s.user)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [createError, setCreateError] = useState('')
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [selectedDepartmentTab, setSelectedDepartmentTab] = useState<string>('all')
  const [projectSearch, setProjectSearch] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [systemLogOpen, setSystemLogOpen] = useState(false)
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
  const [urgentForm, setUrgentForm] = useState({
    title: '',
    description: '',
    assignee_id: '',
    end_date: '',
    control_ski: true,
  })

  const canManageDepartmentLinks = currentUser?.role === 'admin' || currentUser?.role === 'manager' || !!currentUser?.can_manage_team
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: api.listUsers,
  })
  const { data: systemActivity = [] } = useQuery<SystemActivityLog[]>({
    queryKey: ['dashboard-system-activity'],
    queryFn: () => api.listSystemActivityLogs({ hours: 24, limit: 120 }),
    refetchInterval: 20_000,
  })
  const { data: detailedSystemActivity = [] } = useQuery<SystemActivityLog[]>({
    queryKey: ['dashboard-system-activity-detail', systemLogOpen],
    queryFn: () => api.listSystemActivityLogs({ hours: 24, limit: 2000 }),
    enabled: systemLogOpen,
    refetchInterval: systemLogOpen ? 20_000 : false,
  })

  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * IT_QUOTES.length))
  const [wisdomUpdatedAt, setWisdomUpdatedAt] = useState(() => new Date())
  const sevenDaysAgo = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString()
  }, [])
  const wisdomQuote = IT_QUOTES[quoteIndex] ?? IT_QUOTES[0]

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
    const pickRandomQuote = () => {
      setQuoteIndex((prev) => {
        if (IT_QUOTES.length <= 1) return 0
        let next = Math.floor(Math.random() * IT_QUOTES.length)
        while (next === prev) next = Math.floor(Math.random() * IT_QUOTES.length)
        return next
      })
      setWisdomUpdatedAt(new Date())
    }

    const intervalId = window.setInterval(pickRandomQuote, 15 * 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [])

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

  const myUrgentTasks = useMemo(() => {
    if (!currentUser?.id) return [] as Task[]
    return tasks
      .filter((t) => {
        if (t.status === 'done') return false
        const assignedIds = t.assignee_ids ?? []
        return t.created_by_id === currentUser.id || t.assigned_to_id === currentUser.id || assignedIds.includes(currentUser.id)
      })
      .sort((a, b) => {
        const ad = daysUntil(a.end_date)
        const bd = daysUntil(b.end_date)
        const scoreA = ad === null ? 10_000 : ad
        const scoreB = bd === null ? 10_000 : bd
        if (scoreA !== scoreB) return scoreA - scoreB
        return b.updated_at.localeCompare(a.updated_at)
      })
      .slice(0, 10)
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

  const weekSignals = useMemo(() => {
    const created = tasks.filter((t) => t.created_at >= sevenDaysAgo).length
    const updated = tasks.filter((t) => t.updated_at >= sevenDaysAgo).length
    const completed = tasks.filter((t) => t.status === 'done' && t.updated_at >= sevenDaysAgo).length
    const stale = tasks.filter((t) => t.status !== 'done' && t.updated_at < sevenDaysAgo).length
    return { created, updated, completed, stale }
  }, [tasks, sevenDaysAgo])

  const statusStats = useMemo(() => {
    const counts: Record<string, number> = { planning: 0, tz: 0, todo: 0, in_progress: 0, testing: 0, review: 0, done: 0 }
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

  const handleCreateUrgentTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!urgentForm.title.trim()) return
    let targetProject = projects.find((p) => p.name === URGENT_INBOX_PROJECT_NAME)
    if (!targetProject) {
      targetProject = await createProject.mutateAsync({
        name: URGENT_INBOX_PROJECT_NAME,
        description: 'Служебный inbox для срочных задач без привязки к рабочим проектам.',
        color: '#ef4444',
        status: 'active',
        priority: 'high',
      })
    }
    if (!targetProject?.id) return
    await createTask.mutateAsync({
      projectId: targetProject.id,
      data: {
        title: urgentForm.title.trim(),
        description: urgentForm.description.trim() || undefined,
        status: 'todo',
        priority: 'high',
        control_ski: urgentForm.control_ski,
        assigned_to_id: urgentForm.assignee_id || undefined,
        assignee_ids: urgentForm.assignee_id ? [urgentForm.assignee_id] : undefined,
        end_date: urgentForm.end_date || undefined,
      },
    })
    setUrgentForm((prev) => ({
      ...prev,
      title: '',
      description: '',
      assignee_id: '',
      end_date: '',
      control_ski: true,
    }))
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
    <div className="space-y-4 px-4 py-4">
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard
          title="ИТ проекты по отделам"
          className="xl:col-span-5"
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

          <div className="max-h-[590px] space-y-1.5 overflow-auto pr-1">
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

        <SectionCard title="Срочные задачи" className="xl:col-span-2">
          <form className="space-y-2" onSubmit={handleCreateUrgentTask}>
            <Input
              value={urgentForm.title}
              onChange={(e) => setUrgentForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Быстрая заметка / задача"
              className="h-8 text-xs"
              required
            />
            <Input
              value={urgentForm.description}
              onChange={(e) => setUrgentForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Комментарий"
              className="h-8 text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={urgentForm.assignee_id}
                onChange={(e) => setUrgentForm((f) => ({ ...f, assignee_id: e.target.value }))}
                className="rounded border bg-background px-2 py-1.5 text-xs"
              >
                <option value="">Ответственный</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
              <Input
                type="date"
                value={urgentForm.end_date}
                onChange={(e) => setUrgentForm((f) => ({ ...f, end_date: e.target.value }))}
                className="h-8 text-xs"
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={urgentForm.control_ski}
                onChange={(e) => setUrgentForm((f) => ({ ...f, control_ski: e.target.checked }))}
              />
              Контроль СКИ
            </label>
            <p className="text-[11px] text-muted-foreground">По умолчанию: приоритет Высокий</p>
            <p className="text-[11px] text-muted-foreground">Создаются в отдельном inbox «Срочные задачи (вне проектов)»</p>
            <Button type="submit" className="w-full" size="sm" disabled={createTask.isPending}>
              {createTask.isPending ? 'Создание...' : 'Добавить срочную задачу'}
            </Button>
          </form>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="Последние обновленные задачи" className="xl:col-span-5" action={<Users2 className="h-4 w-4 text-muted-foreground" />}>
          <div className="max-h-64 space-y-1 overflow-auto">
            {recentTasks.map((task: Task) => (
              <Link key={task.id} to={`/projects/${task.project_id}`} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-accent">
                <div className="min-w-0">
                  <p className="truncate">{task.title}</p>
                  <p className="text-xs text-muted-foreground">Обновлено: {humanizeTaskUpdateTime(task.updated_at)}</p>
                </div>
                <span className="ml-3 shrink-0 text-xs text-muted-foreground">{TASK_STATUS_LABEL[task.status]}</span>
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Мои задачи" className="xl:col-span-3">
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
                    {TASK_STATUS_LABEL[task.status] ?? task.status} · {formatDate(task.end_date)}
                    {d === null ? ' · без дедлайна' : d < 0 ? ' · просрочено' : ` · ${d} дн.`}
                  </p>
                </Link>
              )
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="Мудрость дня"
          className="xl:col-span-2"
        >
          <button
            type="button"
            onClick={() => {
              setQuoteIndex((prev) => {
                if (IT_QUOTES.length <= 1) return 0
                let next = Math.floor(Math.random() * IT_QUOTES.length)
                while (next === prev) next = Math.floor(Math.random() * IT_QUOTES.length)
                return next
              })
              setWisdomUpdatedAt(new Date())
            }}
            className="flex h-64 w-full flex-col justify-start overflow-auto rounded-lg border border-emerald-700/60 bg-black p-2 text-left align-top font-mono text-[11px] leading-relaxed text-emerald-400 shadow-[inset_0_0_24px_rgba(16,185,129,0.2)]"
            title="Кликните для новой цитаты"
          >
            <div className="space-y-1">
              <p>[{wisdomUpdatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}] [wisdom_bot] quote_loaded</p>
              <p className="whitespace-pre-wrap text-base leading-7">“{wisdomQuote}”</p>
              <p className="text-emerald-500/80">[info] Обновляется случайно каждые 15 минут + кликом по окну.</p>
            </div>
          </button>
        </SectionCard>

        <SectionCard
          title="Активность системы"
          className="xl:col-span-2"
          action={
            <button type="button" onClick={() => setSystemLogOpen(true)} className="text-xs text-primary hover:underline">
              Открыть лог
            </button>
          }
        >
          <div className="h-64 overflow-auto rounded-lg border border-emerald-700/60 bg-black p-2 font-mono text-[11px] leading-relaxed text-emerald-400 shadow-[inset_0_0_24px_rgba(16,185,129,0.2)]">
            {systemActivity.length === 0 ? (
              <p className="text-emerald-500/80">[idle] Нет системных событий за 24 часа</p>
            ) : (
              <div className="space-y-1">
                {systemActivity.slice(0, 40).map((item) => (
                  <p key={item.id} className="truncate">
                    [{new Date(item.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}] [{item.level}] {item.source}: {item.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <Dialog open={systemLogOpen} onOpenChange={setSystemLogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Лог системы (последние 24 часа)</DialogTitle>
          </DialogHeader>
          <div className="max-h-[62vh] overflow-auto rounded-md border bg-background p-2">
            {detailedSystemActivity.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">[idle] Нет системных событий за последние 24 часа</p>
            ) : (
              detailedSystemActivity.map((item, index) => (
                <div key={item.id} className="px-2 py-1.5 text-xs">
                  <p className="leading-relaxed">
                    {new Intl.DateTimeFormat('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(item.created_at))}{' '}
                    [{item.level}] {item.category}/{item.source} :: {item.message}
                  </p>
                  {item.details && Object.keys(item.details).length > 0 && (
                    <pre className="mt-1 overflow-auto rounded border bg-muted/30 px-2 py-1 text-[11px] whitespace-pre-wrap break-words">
                      {JSON.stringify(item.details, null, 2)}
                    </pre>
                  )}
                  {index < detailedSystemActivity.length - 1 && (
                    <div className="my-2 text-muted-foreground">────────────────────────────────────────</div>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

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
