import { Link } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatUserDisplayName } from '@/lib/userName'
import type { Project, Task } from '@/types'

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return `rgba(99,102,241,${alpha})`
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

type DepartmentTab = {
  department_id: string
  department_name: string
  projects: Project[]
}

type DashboardProjectsSectionProps = {
  projectSearch: string
  onProjectSearchChange: (value: string) => void
  onlyMine: boolean
  onToggleOnlyMine: () => void
  projectListDensity: 'compact' | 'normal'
  onProjectListDensityChange: (value: 'compact' | 'normal') => void
  selectedDepartmentTab: string
  onSelectDepartmentTab: (value: string) => void
  departmentTabs: DepartmentTab[]
  projectsForSelectedTab: Project[]
  projectProgressById: Record<string, number>
  canManageDepartmentLinks: boolean
  onOpenAssignDialog: (project: Project) => void
  myTasks: Task[]
  departmentNameById: Record<string, string>
  projectStatusLabel: Record<string, string>
  taskStatusLabel: Record<string, string>
  formatDate: (value?: string) => string
  daysUntil: (value?: string) => number | null
}

export function DashboardProjectsSection({
  projectSearch,
  onProjectSearchChange,
  onlyMine,
  onToggleOnlyMine,
  projectListDensity,
  onProjectListDensityChange,
  selectedDepartmentTab,
  onSelectDepartmentTab,
  departmentTabs,
  projectsForSelectedTab,
  projectProgressById,
  canManageDepartmentLinks,
  onOpenAssignDialog,
  myTasks,
  departmentNameById,
  projectStatusLabel,
  taskStatusLabel,
  formatDate,
  daysUntil,
}: DashboardProjectsSectionProps) {
  return (
    <div className="h-full rounded-xl border bg-card p-4 xl:col-span-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">ИТ проекты по отделам</h2>
        <Input value={projectSearch} onChange={(e) => onProjectSearchChange(e.target.value)} placeholder="Поиск проекта" className="h-8 w-48 text-xs" />
      </div>

      <div className="-mx-4 sticky top-0 z-10 mb-3 border-b bg-card/95 px-4 pb-3 pt-1 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleOnlyMine}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium transition-all animate-pulse',
              onlyMine
                ? 'border-blue-600 bg-blue-600/15 text-blue-700 shadow-[0_0_12px_rgba(37,99,235,0.45)]'
                : 'border-blue-400/80 bg-blue-500/10 text-blue-700 shadow-[0_0_10px_rgba(59,130,246,0.3)]'
            )}
          >
            Мои проекты и задачи
          </button>
          <select
            value={projectListDensity}
            onChange={(e) => onProjectListDensityChange(e.target.value as 'compact' | 'normal')}
            className="rounded-md border bg-background px-2 py-1.5 text-xs text-muted-foreground"
          >
            <option value="compact">Плотность: компактно</option>
            <option value="normal">Плотность: обычная</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSelectDepartmentTab('all')}
            className={cn('rounded-md border px-2 py-1 text-xs', selectedDepartmentTab === 'all' ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}
          >
            Все отделы
          </button>
          {departmentTabs.map((dep) => (
            <button
              key={dep.department_id}
              type="button"
              onClick={() => onSelectDepartmentTab(dep.department_id)}
              className={cn('rounded-md border px-2 py-1 text-xs', selectedDepartmentTab === dep.department_id ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}
            >
              {dep.department_name} ({dep.projects.length})
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[590px] space-y-1.5 overflow-auto pr-1">
        {projectsForSelectedTab.length === 0 && <p className="text-sm text-muted-foreground">Проектов не найдено.</p>}
        {projectsForSelectedTab.map((project) => (
          <div
            key={project.id}
            className={cn(
              'rounded-lg border transition-all',
              projectListDensity === 'compact' ? 'p-2' : 'p-2.5',
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
                <Link
                  to={`/projects/${project.id}`}
                  className={cn('truncate font-semibold hover:text-primary', projectListDensity === 'compact' ? 'text-[13px]' : 'text-sm')}
                >
                  {project.name}
                </Link>
                <p className={cn('text-muted-foreground', projectListDensity === 'compact' ? 'text-[11px]' : 'text-xs')}>
                  {projectStatusLabel[project.status] ?? project.status} · исполнение: {projectProgressById[project.id] ?? 0}% · дедлайн: {formatDate(project.end_date)} · владелец: {formatUserDisplayName(project.owner)}
                </p>
                {!!project.department_ids?.length && (
                  <p className={cn('mt-1 text-muted-foreground', projectListDensity === 'compact' ? 'text-[11px]' : 'text-xs')}>
                    Отделы: {project.department_ids.map((id) => departmentNameById[id] ?? id).join(', ')}
                  </p>
                )}
              </div>
              {canManageDepartmentLinks && (
                <Button size="sm" variant="outline" onClick={() => onOpenAssignDialog(project)}>
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
                  {taskStatusLabel[task.status] ?? task.status} · дедлайн: {formatDate(task.end_date)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
