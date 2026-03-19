import { useMemo } from 'react'
import type { Department, Project, Task } from '@/types'

type DepartmentTab = {
  department_id: string
  department_name: string
  projects: Project[]
}

type Params = {
  tasks: Task[]
  projects: Project[]
  departments: Department[]
  departmentTabs: DepartmentTab[]
  selectedDepartmentTab: string
  projectSearch: string
  onlyMine: boolean
  currentUserId?: string
  sevenDaysAgo: string
  daysUntil: (value?: string) => number | null
}

export function useDashboardMetrics({
  tasks,
  projects,
  departments,
  departmentTabs,
  selectedDepartmentTab,
  projectSearch,
  onlyMine,
  currentUserId,
  sevenDaysAgo,
  daysUntil,
}: Params) {
  const myProjectIds = useMemo(() => {
    if (!currentUserId) return new Set<string>()
    const ids = new Set<string>()
    for (const p of projects) {
      if (p.owner_id === currentUserId) ids.add(p.id)
    }
    for (const t of tasks) {
      const assignedIds = t.assignee_ids ?? []
      if (t.project_id && (t.created_by_id === currentUserId || t.assigned_to_id === currentUserId || assignedIds.includes(currentUserId))) {
        ids.add(t.project_id)
      }
    }
    return ids
  }, [projects, tasks, currentUserId])

  const myTasks = useMemo(() => {
    if (!currentUserId) return [] as Task[]
    return tasks
      .filter((t) => {
        const assignedIds = t.assignee_ids ?? []
        return t.created_by_id === currentUserId || t.assigned_to_id === currentUserId || assignedIds.includes(currentUserId)
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 8)
  }, [tasks, currentUserId])

  const myUrgentTasks = useMemo(() => {
    if (!currentUserId) return [] as Task[]
    return tasks
      .filter((t) => {
        if (t.status === 'done') return false
        const assignedIds = t.assignee_ids ?? []
        return t.created_by_id === currentUserId || t.assigned_to_id === currentUserId || assignedIds.includes(currentUserId)
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
  }, [tasks, currentUserId, daysUntil])

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
    [tasks, daysUntil]
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
    [tasks, daysUntil]
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

  return {
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
  }
}
