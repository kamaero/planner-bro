import type { Task } from '@/types'

type TaskLike = Pick<Task, 'id' | 'title' | 'parent_task_id'>

export function parseTaskOrderFromTitle(title: string): number[] | null {
  const match = title.match(/^(\d+(?:\.\d+)*)(?:[.)])?\s+/)
  if (!match) return null
  const values = match[1].split('.').map((part) => Number.parseInt(part, 10))
  if (values.some((v) => !Number.isFinite(v))) return null
  return values
}

export function compareTasksByOrder(a: Pick<TaskLike, 'title' | 'id'>, b: Pick<TaskLike, 'title' | 'id'>): number {
  const ao = parseTaskOrderFromTitle(a.title)
  const bo = parseTaskOrderFromTitle(b.title)
  if (ao && bo) {
    const maxLen = Math.max(ao.length, bo.length)
    for (let i = 0; i < maxLen; i += 1) {
      const av = ao[i] ?? 0
      const bv = bo[i] ?? 0
      if (av !== bv) return av - bv
    }
    return a.title.localeCompare(b.title, 'ru')
  }
  if (ao && !bo) return -1
  if (!ao && bo) return 1
  const byTitle = a.title.localeCompare(b.title, 'ru')
  if (byTitle !== 0) return byTitle
  return a.id.localeCompare(b.id)
}

export function sortTasksByOrder<T extends TaskLike>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => compareTasksByOrder(a, b))
}

export function buildTaskHierarchy<T extends TaskLike>(tasks: T[]): { ordered: T[]; depthById: Map<string, number> } {
  const sorted = sortTasksByOrder(tasks)
  const visibleIds = new Set(sorted.map((task) => task.id))
  const children = new Map<string, T[]>()
  const roots: T[] = []

  for (const task of sorted) {
    const parentId = task.parent_task_id
    if (parentId && visibleIds.has(parentId)) {
      const arr = children.get(parentId) ?? []
      arr.push(task)
      children.set(parentId, arr)
    } else {
      roots.push(task)
    }
  }

  const ordered: T[] = []
  const depthById = new Map<string, number>()
  const visited = new Set<string>()
  const append = (node: T, depth: number) => {
    if (visited.has(node.id)) return
    visited.add(node.id)
    depthById.set(node.id, Math.max(0, Math.min(6, depth)))
    ordered.push(node)
    const kids = children.get(node.id) ?? []
    for (const child of kids) append(child, depth + 1)
  }

  for (const root of roots) append(root, 0)
  for (const task of sorted) append(task, depthById.get(task.id) ?? 0)

  return { ordered, depthById }
}
