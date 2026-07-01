import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useCreateProject, useProjects, useUpdateProject } from '@/hooks/useProjects'
import { useStatusSnapshotReport } from '@/hooks/useReports'
import { api } from '@/api/client'
import { Plus, Building2, Users2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useAuthStore } from '@/store/authStore'
import type { Department, Project, User, SystemActivityLog } from '@/types'
import { formatUserDisplayName } from '@/lib/userName'
import {
  cn,
  PROJECT_TEMPLATES,
  PROJECT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  PROJECT_KIND_LABEL,
  REPORT_VISIBILITY_LABEL,
  formatDate,
  humanizeTaskUpdateTime,
  parseDateOnly,
  daysUntil,
  deadlinePulseClass,
  myTaskUrgencyClass,
  hexToRgba,
  isDigestQueueLog,
} from './dashboardUtils'
import { MyTasksCard, SkiControlList, WisdomCard, SystemLogTerminal, SignalBadges } from './dashboardWidgets'
import { SectionCard } from './SectionCard'

export function Dashboard() {
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const { data: report, isLoading: reportLoading } = useStatusSnapshotReport()
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
  const [systemLogOpen, setSystemLogOpen] = useState(false)
  const [assignProject, setAssignProject] = useState<Project | null>(null)
  const [assignDepartmentIds, setAssignDepartmentIds] = useState<string[]>([])
  const [form, setForm] = useState({
    name: '',
    description: '',
    color: '#6366f1',
    template: 'blank',
    priority: 'medium',
    report_visibility: 'always',
    control_ski: false,
    launch_basis_text: '',
    start_date: '',
    end_date: '',
    department_ids: [] as string[],
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


  const totalTasks = useMemo(
    () => report?.status_counts.reduce((sum, item) => sum + item.count, 0) ?? 0,
    [report]
  )

  const departmentTabs = useMemo(() => {
    const mainProjects = projects.filter((project) => (project.report_track ?? 'main') === 'main' && (project.report_visibility ?? 'always') !== 'hidden')
    const countByDepartment = new Map<string, number>()
    mainProjects.forEach((project) => {
      project.department_ids?.forEach((departmentId) => {
        countByDepartment.set(departmentId, (countByDepartment.get(departmentId) ?? 0) + 1)
      })
    })
    return departments.map((department) => ({
      department_id: department.id,
      department_name: department.name,
      projects_count: countByDepartment.get(department.id) ?? 0,
    }))
  }, [departments, projects])

  useEffect(() => {
    if (selectedDepartmentTab === 'all') return
    const exists = departmentTabs.some((dep) => dep.department_id === selectedDepartmentTab)
    if (!exists) setSelectedDepartmentTab('all')
  }, [departmentTabs, selectedDepartmentTab])

  const myProjectIds = useMemo(() => {
    if (!currentUser?.id) return new Set<string>()
    const ids = new Set<string>()
    for (const p of projects) {
      if (p.owner_id === currentUser.id) ids.add(p.id)
    }
    for (const task of report?.my_tasks ?? []) {
      ids.add(task.project_id)
    }
    return ids
  }, [projects, report?.my_tasks, currentUser?.id])

  const myUrgentTasks = report?.my_tasks ?? []

  const projectsForSelectedTab = useMemo(() => {
    const source =
      selectedDepartmentTab === 'all'
        ? projects.filter((project) => (project.report_track ?? 'main') === 'main' && (project.report_visibility ?? 'always') !== 'hidden')
        : projects.filter((project) =>
            (project.report_track ?? 'main') === 'main' &&
            (project.report_visibility ?? 'always') !== 'hidden' &&
            project.department_ids?.includes(selectedDepartmentTab)
          )
    const mineFiltered = onlyMine ? source.filter((project) => myProjectIds.has(project.id)) : source
    const q = projectSearch.trim().toLowerCase()
    if (!q) return mineFiltered
    return mineFiltered.filter((project) => {
      const hay = `${project.name} ${project.description ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [projects, selectedDepartmentTab, projectSearch, onlyMine, myProjectIds])

  const competenceCenterProjects = useMemo(
    () => projects
      .filter((project) => project.report_track === 'competence_centers' && project.report_visibility !== 'hidden')
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [projects]
  )

  const initiativeProjects = useMemo(
    () => projects
      .filter((project) => project.report_track === 'initiatives' && project.report_visibility !== 'hidden')
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [projects]
  )

  const adminPlanProjects = useMemo(
    () => projects
      .filter((project) => project.report_track === 'admin' || project.project_kind === 'department_plan')
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [projects]
  )

  const weekSignals = useMemo(() => {
    const created = report?.activity.tasks_created ?? 0
    const updated = report?.activity.tasks_updated ?? 0
    const completed = report?.activity.tasks_completed ?? 0
    const stale = report?.projects.reduce((sum, project) => sum + project.stale_tasks, 0) ?? 0
    return { created, updated, completed, stale }
  }, [report])

  const statusStats = useMemo(() => {
    const counts: Record<string, number> = { planning: 0, tz: 0, todo: 0, in_progress: 0, testing: 0, review: 0, done: 0 }
    report?.status_counts.forEach((item) => { counts[item.key] = item.count })
    return counts
  }, [report?.status_counts])

  const recentTasks = report?.recent_tasks ?? []
  const skiControlTasks = report?.control_ski_tasks ?? []
  const upcomingDeadlines = report?.upcoming_deadlines ?? []

  const departmentNameById = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d.name])),
    [departments]
  )

  const projectProgressById = useMemo(() => {
    const result: Record<string, number> = {}
    report?.projects.forEach((project) => { result[project.id] = project.progress_percent })
    return result
  }, [report?.projects])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    try {
      const created = await createProject.mutateAsync({
        ...form,
        status: 'active',
        priority: form.control_ski ? 'critical' : form.priority,
        report_visibility: form.report_visibility,
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
        report_visibility: 'always',
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

  if (projectsLoading || reportLoading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">Загрузка...</div>
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Дэшборд IT</h1>
          <p className="text-sm text-muted-foreground">{projects.length} проектов · {totalTasks} задач</p>
          <SignalBadges
            created={weekSignals.created}
            updated={weekSignals.updated}
            completed={weekSignals.completed}
            stale={weekSignals.stale}
            escalations={report?.escalations_count ?? 0}
            ski={skiControlTasks.length}
          />
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
              <label className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm">
                <span>Включать в scope доклада</span>
                <input
                  type="checkbox"
                  checked={form.report_visibility !== 'hidden'}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, report_visibility: e.target.checked ? 'always' : 'hidden' }))
                  }
                />
              </label>
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

      <div className="space-y-4">
        <SectionCard
          title="Крупные проекты"
          className="xl:col-span-12"
          action={
            <Input value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} placeholder="Поиск проекта" className="h-8 w-48 text-xs" />
          }
        >
          <div className="mb-3">
            <button
              type="button"
              onClick={() => setOnlyMine((v) => !v)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                onlyMine
                  ? 'border-blue-600 bg-blue-600/15 text-blue-700 shadow-[0_0_12px_rgba(37,99,235,0.45)]'
                  : 'border-border text-muted-foreground hover:border-blue-400 hover:text-blue-700'
              )}
            >
              Мои проекты
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
              {dep.department_name} ({dep.projects_count})
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
                    <Link to={`/projects/${project.id}`} className="block truncate text-sm font-semibold hover:text-primary">
                      {project.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {PROJECT_STATUS_LABEL[project.status] ?? project.status} · исполнение: {projectProgressById[project.id] ?? 0}% · дедлайн: {formatDate(project.end_date)} · владелец: {formatUserDisplayName(project.owner)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {PROJECT_KIND_LABEL[project.project_kind ?? 'major_project'] ?? project.project_kind} · {REPORT_VISIBILITY_LABEL[project.report_visibility ?? 'always'] ?? project.report_visibility}
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
          <div className="mt-4 grid gap-3 border-t pt-3">
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">ЦК / аутсорсинг</p>
              <div className="space-y-1">
                {competenceCenterProjects.length === 0 && <p className="text-xs text-muted-foreground">ЦК не настроены.</p>}
                {competenceCenterProjects.map((project) => (
                  <Link key={project.id} to={`/projects/${project.id}`} className="flex items-center justify-between rounded border px-2 py-1.5 text-xs hover:bg-accent">
                    <span className="min-w-0 truncate font-medium">{project.name}</span>
                    <span className="ml-2 shrink-0 text-muted-foreground">{projectProgressById[project.id] ?? 0}%</span>
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Инициативы</p>
              <div className="space-y-1">
                {initiativeProjects.length === 0 && <p className="text-xs text-muted-foreground">Портфелей инициатив нет.</p>}
                {initiativeProjects.map((project) => (
                  <Link key={project.id} to={`/projects/${project.id}`} className="flex items-center justify-between rounded border px-2 py-1.5 text-xs hover:bg-accent">
                    <span className="min-w-0 truncate font-medium">{project.name}</span>
                    <span className="ml-2 shrink-0 text-muted-foreground">{REPORT_VISIBILITY_LABEL[project.report_visibility ?? 'always'] ?? project.report_visibility}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Планы отделов</p>
              <div className="space-y-1">
                {adminPlanProjects.length === 0 && <p className="text-xs text-muted-foreground">Планы отделов не вынесены.</p>}
                {adminPlanProjects.map((project) => (
                  <Link key={project.id} to={`/projects/${project.id}`} className="flex items-center justify-between rounded border px-2 py-1.5 text-xs hover:bg-accent">
                    <span className="min-w-0 truncate font-medium">{project.name}</span>
                    <span className="ml-2 shrink-0 text-muted-foreground">{REPORT_VISIBILITY_LABEL[project.report_visibility ?? 'hidden'] ?? project.report_visibility}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Статусы и дедлайны" className="xl:col-span-12">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Статус-бары */}
            <div className="space-y-3">
              {Object.entries(statusStats).map(([key, value]) => (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{TASK_STATUS_LABEL[key]}</span>
                    <span className="font-semibold tabular-nums">{value}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${totalTasks ? (value / totalTasks) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Ближайшие дедлайны */}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Ближайшие дедлайны</p>
              <div className="max-h-72 space-y-2 overflow-auto pr-1">
                {upcomingDeadlines.length === 0 && <p className="text-xs text-muted-foreground">Нет предстоящих дедлайнов</p>}
                {upcomingDeadlines.map((task, index) => (
                  <Link
                    key={task.id}
                    to={`/projects/${task.project_id}`}
                    className={cn(
                      'block rounded border px-2 py-1.5 text-xs transition-colors',
                      deadlinePulseClass(daysUntil(task.end_date), index === 0) || 'hover:bg-accent'
                    )}
                  >
                    <p className="truncate font-medium">{task.title}</p>
                    <p className="text-muted-foreground">
                      {task.project_name} · {formatDate(task.end_date)}
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

            {/* СКИ контроль */}
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">СКИ контроль ({skiControlTasks.length})</p>
              <div className="max-h-72 overflow-auto pr-1">
                <SkiControlList tasks={skiControlTasks} />
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="Последние обновленные задачи" className="xl:col-span-5" action={<Users2 className="h-4 w-4 text-muted-foreground" />}>
          <div className="max-h-64 space-y-1 overflow-auto">
            {recentTasks.map((task) => (
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

        <SectionCard
          title="Мои задачи"
          className="xl:col-span-3"
          action={<Link to="/my-tasks" className="text-xs text-muted-foreground hover:text-primary transition-colors">Все →</Link>}
        >
          <MyTasksCard tasks={myUrgentTasks} />
        </SectionCard>

        <WisdomCard />

        <SectionCard
          title="System log"
          className="xl:col-span-2"
          action={
            <button type="button" onClick={() => setSystemLogOpen(true)} className="text-xs text-primary hover:underline">
              Open log
            </button>
          }
        >
          <SystemLogTerminal items={systemActivity} />
        </SectionCard>
      </div>

      <Dialog open={systemLogOpen} onOpenChange={setSystemLogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>System log (последние 24 часа)</DialogTitle>
          </DialogHeader>
          <div className="max-h-[62vh] overflow-auto rounded-md border bg-background p-2">
            {detailedSystemActivity.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">[idle] Нет системных событий за последние 24 часа</p>
            ) : (
              detailedSystemActivity.map((item, index) => (
                <div
                  key={item.id}
                  className={cn(
                    'px-2 py-1.5 text-xs',
                    isDigestQueueLog(item) && 'rounded border border-cyan-500/40 bg-cyan-500/10'
                  )}
                >
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
