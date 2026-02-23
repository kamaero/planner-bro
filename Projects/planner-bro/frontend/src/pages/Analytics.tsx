import { useAllTasks } from '@/hooks/useProjects'
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
  Legend,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import type { Task, Project } from '@/types'

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
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
    ['Project', 'Task', 'Status', 'Priority', 'Assignee', 'Start Date', 'End Date', 'Estimated Hours'],
    ...tasks.map((t) => [
      projectMap[t.project_id] ?? t.project_id,
      t.title,
      t.status,
      t.priority,
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
  a.download = 'planner-bro-tasks.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export function Analytics() {
  const { tasks, projects, isLoading } = useAllTasks()

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading analytics...</div>
  }

  const today = new Date().toISOString().slice(0, 10)

  // Metrics
  const totalProjects = projects.length
  const totalTasks = tasks.length
  const overdue = tasks.filter((t) => t.end_date && t.end_date < today && t.status !== 'done').length
  const unassigned = tasks.filter((t) => !t.assigned_to_id).length

  // By status
  const statusCounts = ['todo', 'in_progress', 'review', 'done'].map((s) => ({
    name: STATUS_LABELS[s],
    count: tasks.filter((t) => t.status === s).length,
    fill: STATUS_COLORS[s],
  }))

  // By priority
  const priorityCounts = ['low', 'medium', 'high', 'critical'].map((p) => ({
    name: p.charAt(0).toUpperCase() + p.slice(1),
    value: tasks.filter((t) => t.priority === p).length,
    fill: PRIORITY_COLORS[p],
  }))

  // Project progress
  const projectProgress = projects.map((p) => {
    const projectTasks = tasks.filter((t) => t.project_id === p.id)
    const done = projectTasks.filter((t) => t.status === 'done').length
    const pct = projectTasks.length > 0 ? Math.round((done / projectTasks.length) * 100) : 0
    return { project: p, total: projectTasks.length, done, pct }
  })

  // Team workload
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
        <h1 className="text-2xl font-bold">Analytics</h1>
        <Button variant="outline" size="sm" onClick={() => exportCSV(tasks, projects)}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Projects" value={totalProjects} />
        <MetricCard label="Total Tasks" value={totalTasks} />
        <MetricCard label="Overdue" value={overdue} sub="not yet done, past due date" />
        <MetricCard label="Unassigned" value={unassigned} sub="tasks without assignee" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Tasks by status */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Tasks by Status</h2>
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

        {/* Tasks by priority */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Tasks by Priority</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={priorityCounts}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {priorityCounts.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Project progress */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold mb-4">Project Progress</h2>
        {projectProgress.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          <div className="space-y-3">
            {projectProgress.map(({ project, total, done, pct }) => (
              <div key={project.id}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium">{project.name}</span>
                  <span className="text-muted-foreground">
                    {done}/{total} tasks · {pct}%
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

      {/* Team workload */}
      {workloadData.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Team Workload</h2>
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
    </div>
  )
}
