import { useMemo, useState } from 'react'
import { useDeadlineStats, useGenerateRetrospective, useProjectRetrospective, useProjects } from '@/hooks/useProjects'
import { useStatusSnapshotReport } from '@/hooks/useReports'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Download, AlertTriangle, Activity, ScrollText, RefreshCw } from 'lucide-react'
import { ActivityHeatmap } from '@/components/ActivityHeatmap/ActivityHeatmap'
import type { ReportProjectSummary, StatusSnapshotReport } from '@/types'

const STATUS_LABELS: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  todo: 'К выполнению',
  in_progress: 'В работе',
  testing: 'Тестирование',
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
  planning: '#0ea5e9',
  tz: '#06b6d4',
  todo: '#94a3b8',
  in_progress: '#6366f1',
  testing: '#8b5cf6',
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

function defaultFromDate() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function kpiValue(report: StatusSnapshotReport | undefined, id: string) {
  return Number(report?.kpis.find((item) => item.id === id)?.value ?? 0)
}

function exportCSV(projects: ReportProjectSummary[], report: StatusSnapshotReport) {
  const rows = [
    ['Проект', 'Слой', 'Видимость', 'Статус', 'Приоритет', 'Ответственный', 'Отделы', 'Задач', 'Выполнено', 'Прогресс', 'Просрочено', 'Критические/СКИ', 'Риск', 'Дедлайн'],
    ...projects.map((p) => [
      p.name,
      p.report_track,
      p.report_visibility,
      p.status_label,
      PRIORITY_LABELS[p.priority] ?? p.priority,
      p.owner_name,
      p.department_names.join('; '),
      String(p.total_tasks),
      String(p.done_tasks),
      `${p.progress_percent}%`,
      String(p.overdue_tasks),
      String(p.critical_tasks),
      p.risk_level,
      p.end_date ?? '',
    ]),
  ]
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `planner-bro-analytics-${report.period.from_date}-${report.period.to_date}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function Analytics() {
  const [reportFrom, setReportFrom] = useState(defaultFromDate)
  const [reportTo, setReportTo] = useState(todayDate)
  const [reportProject, setReportProject] = useState('all')
  const { data: report, isLoading } = useStatusSnapshotReport({ from: reportFrom, to: reportTo })
  const { data: projects = [] } = useProjects()
  const { data: deadlineStats } = useDeadlineStats()
  const [retroProjectId, setRetroProjectId] = useState('')
  const { data: retroData } = useProjectRetrospective(retroProjectId || undefined)
  const generateRetro = useGenerateRetrospective()

  const reportProjects = useMemo(() => {
    const source = report?.projects ?? []
    if (reportProject === 'all') return source
    return source.filter((project) => project.id === reportProject)
  }, [report?.projects, reportProject])

  if (isLoading || !report) {
    return <div className="p-6 text-muted-foreground">Загрузка аналитики...</div>
  }

  const totalProjects = kpiValue(report, 'projects_total')
  const totalTasks = report.status_counts.reduce((sum, item) => sum + item.count, 0)
  const overdue = kpiValue(report, 'overdue_tasks')
  const unassigned = kpiValue(report, 'unassigned_tasks')

  const statusCountMap = Object.fromEntries(report.status_counts.map((item) => [item.key, item.count]))
  const statusCounts = ['planning', 'tz', 'todo', 'in_progress', 'testing', 'review', 'done'].map((s) => ({
    name: STATUS_LABELS[s],
    count: statusCountMap[s] ?? 0,
    fill: STATUS_COLORS[s],
  }))

  const priorityCountMap = Object.fromEntries(report.priority_counts.map((item) => [item.key, item.count]))
  const priorityCounts = ['low', 'medium', 'high', 'critical'].map((p) => ({
    name: PRIORITY_LABELS[p],
    value: priorityCountMap[p] ?? 0,
    fill: PRIORITY_COLORS[p],
  }))
  const priorityChartData = priorityCounts.filter((item) => item.value > 0)

  const projectProgress = reportProjects.map((project) => ({
    project,
    total: project.total_tasks,
    done: project.done_tasks,
    pct: project.progress_percent,
  }))

  const workloadData = report.workload.map((item) => ({ name: item.name, count: item.open_tasks }))

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Аналитика</h1>
        <Button variant="outline" size="sm" onClick={() => exportCSV(reportProjects, report)}>
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
          Проектов в отчёте: {reportProjects.length}
        </div>
      </div>

      {/* Metric Cards — full width, 4 columns */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Проекты" value={totalProjects} />
        <MetricCard label="Всего задач" value={totalTasks} />
        <MetricCard label="Просрочено" value={overdue} sub="не завершены и срок уже прошёл" />
        <MetricCard label="Без исполнителя" value={unassigned} sub="задачи без назначенного ответственного" />
      </div>

      {/* Heatmap + Приоритеты — same 2-col grid as Статусы задач */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Активность команды</h2>
          </div>
          <ActivityHeatmap />
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Приоритеты задач</h2>
          {priorityChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет задач для отображения.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={priorityCounts.map(d => ({ ...d, value: Math.max(d.value, 1) }))} margin={{ top: 0, right: 10, bottom: 0, left: -10 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis scale="log" domain={[1, 'auto']} allowDecimals={false} tick={{ fontSize: 12 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip formatter={(v: number) => [v === 1 && priorityCounts.find(d => d.value === 0) ? 0 : v, 'задач']} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {priorityCounts.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left column: Статусы + Нагрузка stacked */}
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border bg-card p-5">
            <h2 className="text-sm font-semibold mb-4">Статусы задач</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusCounts.map(d => ({ ...d, count: Math.max(d.count, 1) }))} margin={{ top: 0, right: 10, bottom: 0, left: -10 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis scale="log" domain={[1, 'auto']} allowDecimals={false} tick={{ fontSize: 12 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                <Tooltip formatter={(v: number) => [v, 'задач']} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {statusCounts.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <h2 className="text-sm font-semibold mb-4">Нагрузка по команде</h2>
            {workloadData.length > 0 ? (
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
            ) : (
              <p className="text-sm text-muted-foreground">Нет данных по нагрузке команды.</p>
            )}
          </div>
        </div>

        {/* Right column: Прогресс по проектам */}
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
      </div>

      {/* Deadline Audit Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <h2 className="text-lg font-semibold">Статистика дедлайнов</h2>
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

      {/* ── Retrospective ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold">Ретроспектива проекта</h2>
        </div>
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            AI анализирует завершённый проект: выполнение задач, учёт времени, нагрузку команды, сдвиги дедлайнов — и формирует структурированный отчёт.
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-48">
              <label className="text-xs text-muted-foreground mb-1 block">Проект</label>
              <select
                value={retroProjectId}
                onChange={(e) => setRetroProjectId(e.target.value)}
                className="w-full text-sm border rounded px-2 py-1.5 bg-background"
              >
                <option value="">— выберите проект —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!retroProjectId || generateRetro.isPending}
              onClick={async () => {
                if (!retroProjectId) return
                try {
                  await generateRetro.mutateAsync(retroProjectId)
                } catch (err: any) {
                  window.alert(err?.response?.data?.detail ?? 'Ошибка генерации ретроспективы')
                }
              }}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${generateRetro.isPending ? 'animate-spin' : ''}`} />
              {generateRetro.isPending ? 'Генерация...' : retroData ? 'Обновить' : 'Сформировать'}
            </Button>
          </div>

          {retroData && (
            <div className="space-y-3">
              {/* Stats row */}
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground border-b pb-3">
                <span>Задач: <b>{retroData.stats.total_tasks}</b></span>
                <span>Выполнено: <b>{retroData.stats.done_pct}%</b></span>
                {retroData.stats.total_planned_h > 0 && (
                  <span>План/факт: <b>{retroData.stats.total_planned_h}ч / {retroData.stats.total_actual_h}ч</b></span>
                )}
                <span>Сдвигов дедлайнов: <b>{retroData.stats.deadline_shift_count}</b> ({retroData.stats.total_shift_days} дн.)</span>
                <span className="ml-auto">
                  Сформировано: {new Date(retroData.generated_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {/* AI content */}
              <pre className="whitespace-pre-wrap text-sm leading-6 font-sans text-foreground">
                {retroData.content}
              </pre>
            </div>
          )}

          {retroProjectId && !retroData && !generateRetro.isPending && (
            <p className="text-sm text-muted-foreground">
              Ретроспектива по этому проекту ещё не сформирована. Нажмите «Сформировать».
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
