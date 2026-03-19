import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useCreateProject, useCreateTask, useDepartmentDashboard, useProjects, useAllTasks, useEscalations, useUpdateProject } from '@/hooks/useProjects'
import { api } from '@/api/client'
import { Plus, Users2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useAuthStore } from '@/store/authStore'
import type { Department, Project, Task, User, SystemActivityLog } from '@/types'
import { formatUserDisplayName } from '@/lib/userName'
import { DashboardProjectsSection } from '@/components/Dashboard/DashboardProjectsSection'
import { DashboardOpsSignalsSection } from '@/components/Dashboard/DashboardOpsSignalsSection'
import { DashboardMyTasksCard, DashboardUrgentTasksCard } from '@/components/Dashboard/DashboardTasksSection'
import { DashboardAssignDepartmentsDialog, DashboardSystemLogDialog } from '@/components/Dashboard/DashboardDialogs'
import { useDashboardMetrics } from '@/hooks/useDashboardMetrics'

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

function isDigestQueueLog(item: SystemActivityLog): boolean {
  return item.source === 'analytics_email' && item.message.toLowerCase().includes('email digest queue tick')
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
  const [projectListDensity, setProjectListDensity] = useState<'compact' | 'normal'>(() => {
    if (typeof window === 'undefined') return 'normal'
    const saved = window.localStorage.getItem('plannerbro-dashboard-project-density')
    return saved === 'compact' ? 'compact' : 'normal'
  })
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
    if (typeof window === 'undefined') return
    window.localStorage.setItem('plannerbro-dashboard-project-density', projectListDensity)
  }, [projectListDensity])

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

  const {
    myTasks,
    myUrgentTasks,
    projectsForSelectedTab,
    weekSignals,
    statusStats,
    projectMap,
    recentTasks,
    skiControlTasks,
    upcomingDeadlines,
    departmentNameById,
    projectProgressById,
  } = useDashboardMetrics({
    tasks,
    projects,
    departments,
    departmentTabs,
    selectedDepartmentTab,
    projectSearch,
    onlyMine,
    currentUserId: currentUser?.id,
    sevenDaysAgo,
    daysUntil,
  })

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
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Контроль СКИ</span>
                <Switch
                  checked={form.control_ski}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({
                      ...f,
                      control_ski: checked,
                      priority: checked ? 'critical' : f.priority,
                    }))
                  }
                />
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
        <DashboardProjectsSection
          projectSearch={projectSearch}
          onProjectSearchChange={setProjectSearch}
          onlyMine={onlyMine}
          onToggleOnlyMine={() => setOnlyMine((v) => !v)}
          projectListDensity={projectListDensity}
          onProjectListDensityChange={setProjectListDensity}
          selectedDepartmentTab={selectedDepartmentTab}
          onSelectDepartmentTab={setSelectedDepartmentTab}
          departmentTabs={departmentTabs}
          projectsForSelectedTab={projectsForSelectedTab}
          projectProgressById={projectProgressById}
          canManageDepartmentLinks={canManageDepartmentLinks}
          onOpenAssignDialog={openAssignDialog}
          myTasks={myTasks}
          departmentNameById={departmentNameById}
          projectStatusLabel={PROJECT_STATUS_LABEL}
          taskStatusLabel={TASK_STATUS_LABEL}
          formatDate={formatDate}
          daysUntil={daysUntil}
        />

        <DashboardOpsSignalsSection
          tasksCount={tasks.length}
          statusStats={statusStats}
          taskStatusLabel={TASK_STATUS_LABEL}
          upcomingDeadlines={upcomingDeadlines}
          weekSignals={weekSignals}
          escalationsCount={escalations.length}
          skiControlTasks={skiControlTasks}
          projectMap={projectMap}
          daysUntil={daysUntil}
          formatDate={formatDate}
          deadlinePulseClass={deadlinePulseClass}
        />

        <DashboardUrgentTasksCard
          urgentForm={urgentForm}
          users={users}
          createTaskPending={createTask.isPending}
          onUrgentSubmit={handleCreateUrgentTask}
          onUrgentFormChange={(patch) => setUrgentForm((prev) => ({ ...prev, ...patch }))}
        />
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

        <DashboardMyTasksCard
          myUrgentTasks={myUrgentTasks}
          taskStatusLabel={TASK_STATUS_LABEL}
          formatDate={formatDate}
          daysUntil={daysUntil}
          myTaskUrgencyClass={myTaskUrgencyClass}
        />

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
          title="System log"
          className="xl:col-span-2"
          action={
            <button type="button" onClick={() => setSystemLogOpen(true)} className="text-xs text-primary hover:underline">
              Open log
            </button>
          }
        >
          <div className="h-64 overflow-auto rounded-lg border border-emerald-700/60 bg-black p-2 font-mono text-[11px] leading-relaxed text-emerald-400 shadow-[inset_0_0_24px_rgba(16,185,129,0.2)]">
            {systemActivity.length === 0 ? (
              <p className="text-emerald-500/80">[idle] Нет системных событий за 24 часа</p>
            ) : (
              <div className="space-y-1">
                {systemActivity.slice(0, 40).map((item) => (
                  <p
                    key={item.id}
                    className={cn(
                      'truncate',
                      isDigestQueueLog(item) && 'rounded border border-cyan-400/60 bg-cyan-500/10 px-1 text-cyan-300'
                    )}
                  >
                    [{new Date(item.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}] [{item.level}] {item.source}: {item.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <DashboardSystemLogDialog
        open={systemLogOpen}
        onOpenChange={setSystemLogOpen}
        detailedSystemActivity={detailedSystemActivity}
      />

      <DashboardAssignDepartmentsDialog
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        assignProject={assignProject}
        departments={departments}
        assignDepartmentIds={assignDepartmentIds}
        updateProjectPending={updateProject.isPending}
        onToggleDepartment={(departmentId, checked) => {
          setAssignDepartmentIds((prev) =>
            checked ? [...prev, departmentId] : prev.filter((id) => id !== departmentId)
          )
        }}
        onSave={saveProjectDepartments}
      />
    </div>
  )
}
