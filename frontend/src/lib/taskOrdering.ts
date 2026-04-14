import type { Task } from '@/types'

type TaskLike = Pick<Task, 'id' | 'title' | 'parent_task_id' | 'order'>

export function parseTaskOrderFromTitle(title: string): number[] | null {
  const match = title.match(/^(\d+(?:\.\d+)*)(?:[.)])?\s+/)
  if (!match) return null
  const values = match[1].split('.').map((part) => Number.parseInt(part, 10))
  if (values.some((v) => !Number.isFinite(v))) return null
  return values
}

export function stripTaskOrderPrefix(title: string): string {
  return title.replace(/^(\d+(?:\.\d+)*)(?:[.)])?\s+/, '').trim()
}

export function compareTasksByOrder(
  a: Pick<TaskLike, 'title' | 'id' | 'order'>,
  b: Pick<TaskLike, 'title' | 'id' | 'order'>,
): number {
  const aOrder = a.order
  const bOrder = b.order
  const aHasOrder = aOrder != null
  const bHasOrder = bOrder != null
  if (aHasOrder && bHasOrder) return (aOrder as number) - (bOrder as number)
  if (aHasOrder && !bHasOrder) return -1
  if (!aHasOrder && bHasOrder) return 1

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

export function buildTaskNumbering<T extends TaskLike>(tasks: T[]): Map<string, string> {
  // Numbering follows current list order (after reorder), not legacy title prefixes.
  const ordered = [...tasks]
  const visibleIds = new Set(ordered.map((task) => task.id))
  const children = new Map<string, T[]>()
  const roots: T[] = []

  for (const task of ordered) {
    const parentId = task.parent_task_id
    if (parentId && visibleIds.has(parentId)) {
      const arr = children.get(parentId) ?? []
      arr.push(task)
      children.set(parentId, arr)
    } else {
      roots.push(task)
    }
  }

  const result = new Map<string, string>()
  const visited = new Set<string>()
  const append = (node: T, prefix: string) => {
    if (visited.has(node.id)) return
    visited.add(node.id)
    result.set(node.id, prefix)
    const kids = children.get(node.id) ?? []
    for (let idx = 0; idx < kids.length; idx += 1) {
      append(kids[idx], `${prefix}.${idx + 1}`)
    }
  }

  for (let idx = 0; idx < roots.length; idx += 1) {
    append(roots[idx], String(idx + 1))
  }
  for (const task of ordered) {
    if (!visited.has(task.id)) {
      append(task, String(result.size + 1))
    }
  }
  return result
}
