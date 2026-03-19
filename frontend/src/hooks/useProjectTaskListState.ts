import { useEffect, useMemo, useState } from 'react'

import { humanizeApiError } from '@/lib/errorMessages'
import { parseTaskOrderFromTitle } from '@/lib/taskOrdering'
import type { Task } from '@/types'

interface BulkUpdateTasksMutation {
  mutateAsync: (args: {
    projectId: string
    data: {
      task_ids: string[]
      status?: string
      priority?: string
      control_ski?: boolean
      assigned_to_id?: string | null
      delete?: boolean
    }
  }) => Promise<unknown>
}

interface UpdateTaskStatusMutation {
  mutateAsync: (args: {
    taskId: string
    status: string
    progress_percent?: number
    next_step?: string | null
  }) => Promise<unknown>
}

interface UseProjectTaskListStateParams {
  projectId: string
  tasks: Task[]
  canManage: boolean
  canBulkEdit: boolean
  canDelete: boolean
  bulkUpdateTasks: BulkUpdateTasksMutation
  updateTaskStatus: UpdateTaskStatusMutation
  taskStatusOrder: Record<string, number>
  taskPriorityOrder: Record<string, number>
}

export function useProjectTaskListState({
  projectId,
  tasks,
  canManage,
  canBulkEdit,
  canDelete,
  bulkUpdateTasks,
  updateTaskStatus,
  taskStatusOrder,
  taskPriorityOrder,
}: UseProjectTaskListStateParams) {
  const [taskSearch, setTaskSearch] = useState('')
  const [taskStatusFilter, setTaskStatusFilter] = useState('all')
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState('all')
  const [taskSortBy, setTaskSortBy] = useState<'order' | 'status' | 'priority'>('order')
  const [taskSortDir, setTaskSortDir] = useState<'asc' | 'desc'>('asc')
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkAssignee, setBulkAssignee] = useState('keep')
  const [bulkPriority, setBulkPriority] = useState('keep')
  const [taskRowSize, setTaskRowSize] = useState<'compact' | 'normal' | 'comfortable'>('normal')

  const filteredTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      const searchOk =
        !taskSearch.trim() ||
        task.title.toLowerCase().includes(taskSearch.toLowerCase()) ||
        (task.description ?? '').toLowerCase().includes(taskSearch.toLowerCase())

      const statusOk = taskStatusFilter === 'all' || task.status === taskStatusFilter

      const assigneeOk =
        taskAssigneeFilter === 'all' ||
        (taskAssigneeFilter === 'unassigned'
          ? !(task.assignee_ids && task.assignee_ids.length > 0) && !task.assigned_to_id
          : task.assigned_to_id === taskAssigneeFilter || (task.assignee_ids ?? []).includes(taskAssigneeFilter))

      return searchOk && statusOk && assigneeOk
    })
    const withIndex = filtered.map((task, idx) => ({ task, idx }))
    withIndex.sort((a, b) => {
      if (taskSortBy === 'status') {
        const diff = (taskStatusOrder[a.task.status] ?? 999) - (taskStatusOrder[b.task.status] ?? 999)
        if (diff !== 0) return taskSortDir === 'asc' ? diff : -diff
      }
      if (taskSortBy === 'priority') {
        const diff = (taskPriorityOrder[a.task.priority] ?? 999) - (taskPriorityOrder[b.task.priority] ?? 999)
        if (diff !== 0) return taskSortDir === 'asc' ? diff : -diff
      }
      if (taskSortBy !== 'order') {
        const byTitle = a.task.title.localeCompare(b.task.title, 'ru')
        if (byTitle !== 0) return taskSortDir === 'asc' ? byTitle : -byTitle
      }
      const ao = parseTaskOrderFromTitle(a.task.title)
      const bo = parseTaskOrderFromTitle(b.task.title)
      if (ao && bo) {
        const maxLen = Math.max(ao.length, bo.length)
        for (let i = 0; i < maxLen; i += 1) {
          const av = ao[i] ?? 0
          const bv = bo[i] ?? 0
          if (av !== bv) return av - bv
        }
        return a.idx - b.idx
      }
      if (ao && !bo) return -1
      if (!ao && bo) return 1
      return a.idx - b.idx
    })
    const sorted = withIndex.map((entry) => entry.task)
    const visibleIds = new Set(sorted.map((task) => task.id))
    const children = new Map<string, Task[]>()
    const roots: Task[] = []

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

    const ordered: Task[] = []
    const visited = new Set<string>()
    const appendTree = (node: Task) => {
      if (visited.has(node.id)) return
      visited.add(node.id)
      ordered.push(node)
      const kids = children.get(node.id) ?? []
      for (const child of kids) appendTree(child)
    }
    for (const root of roots) appendTree(root)
    for (const task of sorted) appendTree(task)

    return ordered
  }, [tasks, taskSearch, taskStatusFilter, taskAssigneeFilter, taskSortBy, taskSortDir, taskStatusOrder, taskPriorityOrder])

  const selectedVisibleCount = filteredTasks.filter((task) => selectedTaskIds.includes(task.id)).length

  useEffect(() => {
    const ids = new Set(tasks.map((task) => task.id))
    setSelectedTaskIds((prev) => prev.filter((id) => ids.has(id)))
  }, [tasks])

  const handleToggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    )
  }

  const handleToggleSelectAllVisible = () => {
    const visibleIds = filteredTasks.map((task) => task.id)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedTaskIds.includes(id))
    if (allVisibleSelected) {
      setSelectedTaskIds((prev) => prev.filter((id) => !visibleIds.includes(id)))
      return
    }
    setSelectedTaskIds((prev) => Array.from(new Set([...prev, ...visibleIds])))
  }

  const handleBulkStatusUpdate = async (status: string) => {
    if (!canManage || !canBulkEdit || selectedTaskIds.length === 0) return
    setBulkBusy(true)
    try {
      await bulkUpdateTasks.mutateAsync({
        projectId,
        data: {
          task_ids: selectedTaskIds,
          status,
        },
      })
      setSelectedTaskIds([])
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось выполнить массовое обновление статуса'))
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkAssign = async () => {
    if (!canManage || !canBulkEdit || selectedTaskIds.length === 0 || bulkAssignee === 'keep') return
    setBulkBusy(true)
    try {
      await bulkUpdateTasks.mutateAsync({
        projectId,
        data: {
          task_ids: selectedTaskIds,
          assigned_to_id: bulkAssignee === 'unassigned' ? null : bulkAssignee,
        },
      })
      setSelectedTaskIds([])
      setBulkAssignee('keep')
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось выполнить массовое назначение'))
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkPriority = async () => {
    if (!canManage || !canBulkEdit || selectedTaskIds.length === 0 || bulkPriority === 'keep') return
    setBulkBusy(true)
    try {
      if (bulkPriority === 'ski') {
        await bulkUpdateTasks.mutateAsync({
          projectId,
          data: {
            task_ids: selectedTaskIds,
            control_ski: true,
          },
        })
      } else {
        await bulkUpdateTasks.mutateAsync({
          projectId,
          data: {
            task_ids: selectedTaskIds,
            priority: bulkPriority,
            control_ski: false,
          },
        })
      }
      setSelectedTaskIds([])
      setBulkPriority('keep')
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось выполнить массовое обновление приоритета'))
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkDelete = async () => {
    if (!canManage || !canBulkEdit || !canDelete || selectedTaskIds.length === 0) return
    if (!window.confirm(`Удалить выбранные задачи (${selectedTaskIds.length})?`)) return
    setBulkBusy(true)
    try {
      await bulkUpdateTasks.mutateAsync({
        projectId,
        data: {
          task_ids: selectedTaskIds,
          delete: true,
        },
      })
      setSelectedTaskIds([])
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось удалить выбранные задачи'))
    } finally {
      setBulkBusy(false)
    }
  }

  const handleQuickStatusChange = async (task: Task, status: string) => {
    const progress = status === 'done' ? 100 : task.progress_percent ?? 0
    try {
      await updateTaskStatus.mutateAsync({
        taskId: task.id,
        status,
        progress_percent: progress,
        next_step: task.next_step ?? null,
      })
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось обновить статус задачи'))
    }
  }

  return {
    taskSearch,
    setTaskSearch,
    taskStatusFilter,
    setTaskStatusFilter,
    taskAssigneeFilter,
    setTaskAssigneeFilter,
    taskSortBy,
    setTaskSortBy,
    taskSortDir,
    setTaskSortDir,
    selectedTaskIds,
    selectedVisibleCount,
    bulkBusy,
    bulkAssignee,
    setBulkAssignee,
    bulkPriority,
    setBulkPriority,
    taskRowSize,
    setTaskRowSize,
    filteredTasks,
    handleToggleTaskSelection,
    handleToggleSelectAllVisible,
    handleBulkStatusUpdate,
    handleBulkAssign,
    handleBulkPriority,
    handleBulkDelete,
    handleQuickStatusChange,
  }
}
