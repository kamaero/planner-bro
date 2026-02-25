import { useMemo, useState } from 'react'
import { useAllTasks, useDeadlineStats } from '@/hooks/useProjects'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Download, AlertTriangle } from 'lucide-react'
import type { Task, Project } from '@/types'

const STATUS_LABELS: Record<string, string> = {
  todo: 'К выполнению',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Выполнено',
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
}

const PRIORITY_COLORS: Record<string, string> = {
  low: '#3b82f6',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
}

const STATUS_COLORS: Record<string, string> = {
  todo: '#94a3b8',
  in_progress: '#6366f1',
  review: '#f59e0b',
  done: '#22c55e',
}

function MetricCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  )
}

function exportCSV(tasks: Task[], projects: Project[]) {
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]))
  const rows = [
    ['Проект', 'Задача', 'Статус', 'Приоритет', 'Исполнитель', 'Дата начала', 'Дедлайн', 'Оценка (ч)'],
    ...tasks.map((t) => [
      projectMap[t.project_id] ?? t.project_id,
      t.title,
      STATUS_LABELS[t.status] ?? t.status,
      PRIORITY_LABELS[t.priority] ?? t.priority,
      t.assignee?.name ?? '',
      t.start_date ?? '',
      t.end_date ?? '',
      String(t.estimated_hours ?? ''),
    ]),
  ]
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'planner-bro-otchet-zadachi.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export function Analytics() {
  const { tasks, projects, isLoading } = useAllTasks()
  const { data: deadlineStats } = useDeadlineStats()
  const [reportFrom, setReportFrom] = useState('')
  const [reportTo, setReportTo] = useState('')
  const [reportProject, setReportProject] = useState('all')

  const today = new Date().toISOString().slice(0, 10)

  const getTaskReportDate = (task: Task) => {
    if (task.end_date) return task.end_date
    if (task.created_at) return task.created_at.slice(0, 10)
    return ''
  }

  const reportTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (reportProject !== 'all' && t.project_id !== reportProject) return false
      const taskDate = getTaskReportDate(t)
      if (reportFrom && taskDate < reportFrom) return false
      if (reportTo && taskDate > reportTo) return false
      return true
    })
  }, [tasks, reportFrom, reportTo, reportProject])

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Загрузка аналитики...</div>
  }

  const totalProjects = projects.length
  const totalTasks = tasks.length
  const overdue = tasks.filter((t) => t.end_date && t.end_date < today && t.status !== 'done').length
  const unassigned = tasks.filter((t) => !t.assigned_to_id).length

  const statusCounts = ['todo', 'in_progress', 'review', 'done'].map((s) => ({
    name: STATUS_LABELS[s],
    count: tasks.filter((t) => t.status === s).length,
    fill: STATUS_COLORS[s],
  }))

  const priorityCounts = ['low', 'medium', 'high', 'critical'].map((p) => ({
    name: PRIORITY_LABELS[p],
    value: tasks.filter((t) => t.priority === p).length,
    fill: PRIORITY_COLORS[p],
  }))
  const priorityChartData = priorityCounts.filter((item) => item.value > 0)

  const projectProgress = projects.map((p) => {
    const projectTasks = tasks.filter((t) => t.project_id === p.id)
    const done = projectTasks.filter((t) => t.status === 'done').length
    const pct = projectTasks.length > 0 ? Math.round((done / projectTasks.length) * 100) : 0
    return { project: p, total: projectTasks.length, done, pct }
  })

  const assigneeCounts: Record<string, { name: string; count: number }> = {}
  tasks.forEach((t) => {
    if (t.assignee) {
      if (!assigneeCounts[t.assigned_to_id!]) {
        assigneeCounts[t.assigned_to_id!] = { name: t.assignee.name, count: 0 }
      }
      assigneeCounts[t.assigned_to_id!].count++
    }
  })
  const workloadData = Object.values(assigneeCounts).sort((a, b) => b.count - a.count)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Аналитика</h1>
        <Button variant="outline" size="sm" onClick={() => exportCSV(reportTasks, projects)}>
          <Download className="w-4 h-4 mr-2" />
          Экспорт CSV (по фильтру)
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-4 grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          type="date"
          value={reportFrom}
          onChange={(e) => setReportFrom(e.target.value)}
          className="text-sm border rounded px-2 py-1 bg-background"
        />
        <input
          type="date"
          value={reportTo}
          onChange={(e) => setReportTo(e.target.value)}
          className="text-sm border rounded px-2 py-1 bg-background"
        />
        <select
          value={reportProject}
          onChange={(e) => setReportProject(e.target.value)}
          className="text-sm border rounded px-2 py-1 bg-background"
        >
          <option value="all">Все проекты</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="text-xs text-muted-foreground flex items-center justify-end">
          Задач в отчёте: {reportTasks.length}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Проекты" value={totalProjects} />
        <MetricCard label="Всего задач" value={totalTasks} />
        <MetricCard label="Просрочено" value={overdue} sub="не завершены и срок уже прошёл" />
        <MetricCard label="Без исполнителя" value={unassigned} sub="задачи без назначенного ответственного" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Статусы задач</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={statusCounts} margin={{ top: 0, right: 10, bottom: 0, left: -10 }}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {statusCounts.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Приоритеты задач</h2>
          {priorityChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет задач для отображения приоритетов.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={priorityChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={78}
                    labelLine
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {priorityChartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-2 pt-2">
                {priorityCounts.map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: item.fill }} />
                      {item.name}
                    </span>
                    <span className="font-semibold">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold mb-4">Прогресс по проектам</h2>
        {projectProgress.length === 0 ? (
          <p className="text-sm text-muted-foreground">Проектов пока нет.</p>
        ) : (
          <div className="space-y-3">
            {projectProgress.map(({ project, total, done, pct }) => (
              <div key={project.id}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium">{project.name}</span>
                  <span className="text-muted-foreground">
                    {done}/{total} задач · {pct}%
                  </span>
                </div>
                <progress
                  value={pct}
                  max={100}
                  className="w-full h-2 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {workloadData.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Нагрузка по команде</h2>
          <ResponsiveContainer width="100%" height={Math.max(180, workloadData.length * 40)}>
            <BarChart
              data={workloadData}
              layout="vertical"
              margin={{ top: 0, right: 20, bottom: 0, left: 80 }}
            >
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={75} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Deadline Audit Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <h2 className="text-lg font-semibold">Честная статистика дедлайнов</h2>
        </div>

        {deadlineStats ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <MetricCard
                label="Переносов дедлайнов"
                value={deadlineStats.total_shifts}
                sub="суммарно по задачам и проектам"
              />
              <MetricCard
                label="Задач с переносами"
                value={deadlineStats.tasks_with_shifts}
                sub="уникальных задач"
              />
              <MetricCard
                label="Средний сдвиг"
                value={deadlineStats.avg_shift_days}
                sub="дней в среднем"
              />
            </div>

            {deadlineStats.real_overdue_tasks.length > 0 && (
              <div className="rounded-xl border bg-card p-5">
                <h3 className="text-sm font-semibold mb-3">
                  Задачи с реальной просрочкой (по изначальному дедлайну)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="text-left pb-2">Задача</th>
                        <th className="text-left pb-2">Исходный дедлайн</th>
                        <th className="text-left pb-2">Текущий дедлайн</th>
                        <th className="text-left pb-2">Переносов</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {deadlineStats.real_overdue_tasks.map((t) => (
                        <tr key={t.id}>
                          <td className="py-2 pr-4 font-medium">{t.title}</td>
                          <td className="py-2 pr-4 text-red-600">
                            {new Date(t.original_end_date).toLocaleDateString('ru-RU')}
                          </td>
                          <td className="py-2 pr-4 text-amber-600">
                            {t.current_end_date
                              ? new Date(t.current_end_date).toLocaleDateString('ru-RU')
                              : '—'}
                          </td>
                          <td className="py-2">
                            <span className="text-amber-600 font-medium">{t.shifts}×</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {deadlineStats.shifts_by_project.length > 0 && (
              <div className="rounded-xl border bg-card p-5">
                <h3 className="text-sm font-semibold mb-3">Переносы по проектам</h3>
                <ResponsiveContainer width="100%" height={Math.max(160, deadlineStats.shifts_by_project.length * 36)}>
                  <BarChart
                    data={deadlineStats.shifts_by_project}
                    layout="vertical"
                    margin={{ top: 0, right: 20, bottom: 0, left: 120 }}
                  >
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                    <YAxis
                      type="category"
                      dataKey="project_name"
                      tick={{ fontSize: 11 }}
                      width={115}
                    />
                    <Tooltip />
                    <Bar dataKey="shifts" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
            Нет данных о переносах дедлайнов.
          </div>
        )}
      </div>
    </div>
  )
}
