import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  useProject,
  useGantt,
  useCriticalPath,
  useTasks,
  useCreateTask,
  useUpdateProject,
  useDeleteProject,
  useUpdateTaskStatus,
  useBulkUpdateTasks,
  useReorderTasks,
  useProjectFiles,
  useProjectDeadlineHistory,
  useProjects,
  useAnalyzeProject,
  useDependencyGraph,
  useProjectExternalDeps,
} from '@/hooks/useProjects'
import { useMembers } from '@/hooks/useMembers'
import { useUsers } from '@/hooks/useUsers'
import { api } from '@/api/client'
import { ProjectDetailGanttSection } from '@/components/ProjectDetail/ProjectDetailGanttSection'
import { ProjectDetailFilesSection } from '@/components/ProjectDetail/ProjectDetailFilesSection'
import { ProjectEditDialog } from '@/components/ProjectDetail/ProjectEditDialog'
import type { ProjectEditFormState } from '@/components/ProjectDetail/ProjectEditDialog'
import { ProjectTaskCreateDialog } from '@/components/ProjectDetail/ProjectTaskCreateDialog'
import type { TaskCreateFormState } from '@/components/ProjectDetail/ProjectTaskCreateDialog'
import { ProjectDetailHeader } from '@/components/ProjectDetail/ProjectDetailHeader'
import { ProjectSummaryCard } from '@/components/ProjectDetail/ProjectSummaryCard'
import { DependencyGraphView } from '@/components/DependencyGraphView'
import { TimeTrackingPanel } from '@/components/TimeTrackingPanel'
import { TaskDrawer } from '@/components/TaskDrawer/TaskDrawer'
import { MembersPanel } from '@/components/MembersPanel/MembersPanel'
import { TaskTable } from '@/components/TaskTable/TaskTable'
import { DeadlineReasonModal } from '@/components/DeadlineReasonModal/DeadlineReasonModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { humanizeApiError } from '@/lib/errorMessages'
import { buildTaskHierarchy, parseTaskOrderFromTitle } from '@/lib/taskOrdering'
import { formatUserDisplayName } from '@/lib/userName'
import type { Task, GanttTask, ProjectFile } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { useMyPermissions } from '@/hooks/useMyPermissions'
import { BrainCircuit, X } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

const STATUS_LABELS: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  todo: 'К выполнению',
  in_progress: 'В работе',
  testing: 'Тестирование',
  review: 'На проверке',
  done: 'Выполнено',
}

const TASK_STATUS_ORDER: Record<string, number> = {
  planning: 0,
  tz: 1,
  todo: 2,
  in_progress: 3,
  testing: 4,
  review: 5,
  done: 6,
}

const TASK_PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}


const DEFAULT_DOD_CHECKLIST = [
  { id: 'scope_approved', label: 'Результаты проекта согласованы', done: false },
  { id: 'docs_prepared', label: 'Документация и инструкции подготовлены', done: false },
  { id: 'handover_done', label: 'Передача в сопровождение завершена', done: false },
  { id: 'retrospective_done', label: 'Ретроспектива проведена', done: false },
]

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function ProjectDetail() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const { data: project } = useProject(id!)
  const { data: allProjects = [] } = useProjects()
  const { data: ganttData } = useGantt(id!)
  const { data: criticalPath } = useCriticalPath(id!)
  const { data: tasks = [], isFetching: tasksFetching } = useTasks(id!)
  const { data: members = [] } = useMembers(id!)
  const { data: users = [] } = useUsers()
  const { data: files = [] } = useProjectFiles(id!)
  const createTask = useCreateTask()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const updateTaskStatus = useUpdateTaskStatus()
  const bulkUpdateTasks = useBulkUpdateTasks()
  const reorderTasks = useReorderTasks()
  const analyzeProject = useAnalyzeProject()
  const currentUser = useAuthStore((s) => s.user)
  const { permissions } = useMyPermissions()

  const [view, setView] = useState<'gantt' | 'list' | 'members' | 'files' | 'graph' | 'time'>('list')
  const { data: depGraph } = useDependencyGraph(view === 'graph' ? id : undefined)
  const { data: projectExternalDeps = {} } = useProjectExternalDeps(id!)
  const showTime = view === 'time'
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [taskForm, setTaskForm] = useState<TaskCreateFormState>({
    title: '',
    description: '',
    priority: 'medium',
    control_ski: false,
    progress_percent: '0',
    next_step: '',
    start_date: '',
    end_date: '',
    estimated_hours: '',
    assigned_to_id: '',
    assignee_ids: [] as string[],
    parent_task_id: '',
    predecessor_task_ids: [] as string[],
    is_escalation: false,
    escalation_for: '',
    escalation_sla_hours: '24',
    repeat_every_days: '',
  })
  const [editForm, setEditForm] = useState<ProjectEditFormState>({
    name: '',
    description: '',
    status: 'planning',
    priority: 'medium',
    control_ski: false,
    planning_mode: 'flexible',
    strict_no_past_start_date: false,
    strict_no_past_end_date: false,
    strict_child_within_parent_dates: true,
    launch_basis_text: '',
    launch_basis_file_id: '',
    start_date: '',
    end_date: '',
    owner_id: '',
    completion_checklist: DEFAULT_DOD_CHECKLIST,
  })
  const [taskSearch, setTaskSearch] = useState('')
  const [taskStatusFilter, setTaskStatusFilter] = useState('all')
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState('all')
  const [hideDone, setHideDone] = useState(false)
  const [taskSortBy, setTaskSortBy] = useState<'order' | 'status' | 'priority'>('order')
  const [taskSortDir, setTaskSortDir] = useState<'asc' | 'desc'>('asc')
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkAssignee, setBulkAssignee] = useState('keep')
  const [bulkPriority, setBulkPriority] = useState('keep')
  const [bulkShiftDays, setBulkShiftDays] = useState('')
  const [bulkShiftReason, setBulkShiftReason] = useState('')
  const [bulkMoveProjectId, setBulkMoveProjectId] = useState('')
  const [aiAnalysisResult, setAiAnalysisResult] = useState<{ analysis: string; stats: Record<string, number>; generated_at: string } | null>(null)
  const [showAiAnalysis, setShowAiAnalysis] = useState(false)
  const [showProjectDeadlineModal, setShowProjectDeadlineModal] = useState(false)
  const [pendingProjectFormData, setPendingProjectFormData] = useState<Record<string, unknown> | null>(null)
  const [showProjectDeadlineHistory, setShowProjectDeadlineHistory] = useState(false)
  const [taskRowSize, setTaskRowSize] = useState<'compact' | 'normal' | 'comfortable'>('normal')
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set())

  const toggleCollapse = (taskId: string) => {
    setCollapsedTaskIds(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const { data: projectDeadlineHistory = [] } = useProjectDeadlineHistory(id)
  // shiftsMap is empty here — per-task shift counts are shown inside TaskDrawer
  // when the user opens a task. Table shows shift indicator only when shifts data is available.
  const shiftsMap = useMemo(() => ({} as Record<string, number>), [])

  const memberRole = members.find((m) => m.user.id === currentUser?.id)?.role
  const canManage = currentUser?.role === 'admin' || memberRole === 'owner' || memberRole === 'manager'
  const canTransferOwnership = currentUser?.role === 'admin' || memberRole === 'owner'
  const canDelete = permissions.actions.delete_project
  const canImport = permissions.actions.import_tasks
  const canBulkEdit = permissions.actions.bulk_edit_tasks
  const canAssignAcrossOrg = useMemo(() => {
    const position = (currentUser?.position_title ?? '').toLowerCase()
    const isGlobalPosition =
      position.includes('гип') ||
      position.includes('главный инженер проектов') ||
      position.includes('зам') ||
      position.includes('заместитель')
    return (
      currentUser?.role === 'admin' ||
      currentUser?.role === 'manager' ||
      !!currentUser?.can_manage_team ||
      isGlobalPosition
    )
  }, [currentUser?.can_manage_team, currentUser?.position_title, currentUser?.role])
  const projectAssigneeOptions = useMemo(() => {
    if (canAssignAcrossOrg || members.length === 0) return users
    const uniqueUsers = new Map<string, (typeof users)[number]>()
    for (const member of members) uniqueUsers.set(member.user.id, member.user)
    return Array.from(uniqueUsers.values())
  }, [canAssignAcrossOrg, members, users])

  const hasChildrenIds = useMemo(() => {
    const ids = new Set<string>()
    for (const task of tasks) {
      if (task.parent_task_id) ids.add(task.parent_task_id)
    }
    return ids
  }, [tasks])

  const handleReorder = (fromIndex: number, toIndex: number) => {
    const newList = [...filteredTasks]
    const [moved] = newList.splice(fromIndex, 1)
    newList.splice(toIndex, 0, moved)
    const items = newList.map((task, idx) => ({ task_id: task.id, order: idx * 1000 }))
    reorderTasks.mutate({ projectId: id!, items })
  }

  const filteredTasks = useMemo(() => {
    const filtered = tasks.filter((task) => {
      const searchOk =
        !taskSearch.trim() ||
        task.title.toLowerCase().includes(taskSearch.toLowerCase()) ||
        (task.description ?? '').toLowerCase().includes(taskSearch.toLowerCase())

      const statusOk = taskStatusFilter === 'all' || task.status === taskStatusFilter
      const doneOk = !hideDone || task.status !== 'done'

      const assigneeOk =
        taskAssigneeFilter === 'all' ||
        (taskAssigneeFilter === 'unassigned'
          ? !(task.assignee_ids && task.assignee_ids.length > 0) && !task.assigned_to_id
          : task.assigned_to_id === taskAssigneeFilter || (task.assignee_ids ?? []).includes(taskAssigneeFilter))

      return searchOk && statusOk && doneOk && assigneeOk
    })
    const withIndex = filtered.map((task, idx) => ({ task, idx }))
    withIndex.sort((a, b) => {
      if (taskSortBy === 'status') {
        const diff = (TASK_STATUS_ORDER[a.task.status] ?? 999) - (TASK_STATUS_ORDER[b.task.status] ?? 999)
        if (diff !== 0) return taskSortDir === 'asc' ? diff : -diff
      }
      if (taskSortBy === 'priority') {
        const diff = (TASK_PRIORITY_ORDER[a.task.priority] ?? 999) - (TASK_PRIORITY_ORDER[b.task.priority] ?? 999)
        if (diff !== 0) return taskSortDir === 'asc' ? diff : -diff
      }
      if (taskSortBy !== 'order') {
        const byTitle = a.task.title.localeCompare(b.task.title, 'ru')
        if (byTitle !== 0) return taskSortDir === 'asc' ? byTitle : -byTitle
      }
      // use explicit order field when set (drag-and-drop ordering)
      const aHasOrder = a.task.order != null
      const bHasOrder = b.task.order != null
      if (aHasOrder && bHasOrder) return (a.task.order as number) - (b.task.order as number)
      if (aHasOrder && !bHasOrder) return -1
      if (!aHasOrder && bHasOrder) return 1
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
    const markVisited = (taskId: string) => {
      if (visited.has(taskId)) return
      visited.add(taskId)
      for (const kid of (children.get(taskId) ?? [])) markVisited(kid.id)
    }
    const appendTree = (node: Task) => {
      if (visited.has(node.id)) return
      visited.add(node.id)
      ordered.push(node)
      if (collapsedTaskIds.has(node.id)) {
        for (const kid of (children.get(node.id) ?? [])) markVisited(kid.id)
      } else {
        for (const child of (children.get(node.id) ?? [])) appendTree(child)
      }
    }
    for (const root of roots) appendTree(root)
    for (const task of sorted) appendTree(task)

    return ordered
  }, [tasks, taskSearch, taskStatusFilter, taskAssigneeFilter, taskSortBy, taskSortDir, collapsedTaskIds, hideDone])

  const selectedVisibleCount = filteredTasks.filter((t) => selectedTaskIds.includes(t.id)).length

  const VIRTUAL_THRESHOLD = 40
  const taskListRef = useRef<HTMLDivElement>(null)
  const taskVirtualizer = useVirtualizer({
    count: filteredTasks.length,
    getScrollElement: () => taskListRef.current,
    estimateSize: () => 110,
    overscan: 5,
  })

  useEffect(() => {
    if (project && editOpen) {
      setEditForm({
        name: project.name,
        description: project.description ?? '',
        status: project.status,
        priority: project.priority,
        control_ski: project.control_ski,
        planning_mode: project.planning_mode ?? 'flexible',
        strict_no_past_start_date: project.strict_no_past_start_date ?? false,
        strict_no_past_end_date: project.strict_no_past_end_date ?? false,
        strict_child_within_parent_dates: project.strict_child_within_parent_dates ?? true,
        launch_basis_text: project.launch_basis_text ?? '',
        launch_basis_file_id: project.launch_basis_file_id ?? '',
        start_date: project.start_date ?? '',
        end_date: project.end_date ?? '',
        owner_id: project.owner_id,
        completion_checklist:
          project.completion_checklist && project.completion_checklist.length > 0
            ? project.completion_checklist
            : DEFAULT_DOD_CHECKLIST,
      })
    }
  }, [project, editOpen])

  const projectProgress = useMemo(() => {
    if (!tasks.length) return 0
    const sum = tasks.reduce((acc, t) => acc + (t.progress_percent ?? 0), 0)
    return Math.round(sum / tasks.length)
  }, [tasks])
  const progressStats = useMemo(() => {
    let completedCount = 0
    let zeroProgressCount = 0
    for (const task of tasks) {
      const progress = task.progress_percent ?? 0
      if (task.status === 'done' || progress >= 100) completedCount += 1
      if (progress === 0) zeroProgressCount += 1
    }
    return { completedCount, zeroProgressCount, totalCount: tasks.length }
  }, [tasks])
  const taskHierarchyOptions = useMemo(() => buildTaskHierarchy(tasks), [tasks])

  const launchBasisFile = useMemo(() => {
    const fileId = project?.launch_basis_file_id
    if (!fileId) return null
    return files.find((f) => f.id === fileId) ?? null
  }, [files, project?.launch_basis_file_id])

  useEffect(() => {
    const ids = new Set(tasks.map((t) => t.id))
    setSelectedTaskIds((prev) => prev.filter((id) => ids.has(id)))
  }, [tasks])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const taskId = params.get('task')
    if (!taskId || tasks.length === 0) return
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    setSelectedTask(task)
    setDrawerOpen(true)
  }, [location.search, tasks])

  useEffect(() => {
    if (!selectedTask) return
    const updated = tasks.find((t) => t.id === selectedTask.id)
    if (updated) setSelectedTask(updated)
  }, [tasks, selectedTask])

  const handleGanttTaskClick = (ganttTask: GanttTask) => {
    const task = tasks.find((t) => t.id === ganttTask.id)
    if (task) {
      setSelectedTask(task)
      setDrawerOpen(true)
    }
  }

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task)
    setDrawerOpen(true)
  }

  const handleToggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    )
  }

  const handleToggleSelectAllVisible = () => {
    const visibleIds = filteredTasks.map((t) => t.id)
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
        projectId: id!,
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
        projectId: id!,
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
          projectId: id!,
          data: {
            task_ids: selectedTaskIds,
            control_ski: true,
          },
        })
      } else {
        await bulkUpdateTasks.mutateAsync({
          projectId: id!,
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
        projectId: id!,
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

  const handleBulkShiftDeadline = async () => {
    const days = parseInt(bulkShiftDays, 10)
    if (!canManage || !canBulkEdit || selectedTaskIds.length === 0) return
    if (!days || days === 0) return window.alert('Укажите количество дней (не ноль)')
    if (!bulkShiftReason.trim()) return window.alert('Укажите причину изменения дедлайна')
    setBulkBusy(true)
    try {
      await bulkUpdateTasks.mutateAsync({
        projectId: id!,
        data: {
          task_ids: selectedTaskIds,
          end_date_shift_days: days,
          deadline_change_reason: bulkShiftReason.trim(),
        },
      })
      setSelectedTaskIds([])
      setBulkShiftDays('')
      setBulkShiftReason('')
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось сдвинуть дедлайны'))
    } finally {
      setBulkBusy(false)
    }
  }

  const handleAiAnalysis = async () => {
    try {
      const result = await analyzeProject.mutateAsync(id!)
      setAiAnalysisResult({ analysis: result.analysis, stats: result.stats, generated_at: result.generated_at })
      setShowAiAnalysis(true)
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось запустить AI-анализ. Проверьте настройки DEEPSEEK_API_KEY.'))
    }
  }

  const handleBulkMoveToProject = async () => {
    if (!canManage || !canBulkEdit || selectedTaskIds.length === 0 || !bulkMoveProjectId) return
    if (!window.confirm(`Перенести ${selectedTaskIds.length} задач(и) в другой проект?`)) return
    setBulkBusy(true)
    try {
      await bulkUpdateTasks.mutateAsync({
        projectId: id!,
        data: {
          task_ids: selectedTaskIds,
          target_project_id: bulkMoveProjectId,
        },
      })
      setSelectedTaskIds([])
      setBulkMoveProjectId('')
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось перенести задачи'))
    } finally {
      setBulkBusy(false)
    }
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createTask.mutateAsync({
        projectId: id!,
        data: {
          ...taskForm,
          priority: taskForm.control_ski ? 'critical' : taskForm.priority,
          estimated_hours: taskForm.estimated_hours ? parseInt(taskForm.estimated_hours) : undefined,
          progress_percent: taskForm.progress_percent ? parseInt(taskForm.progress_percent) : 0,
          next_step: taskForm.next_step || undefined,
          start_date: taskForm.start_date || undefined,
          end_date: taskForm.end_date || undefined,
          assigned_to_id: taskForm.assigned_to_id || undefined,
          assignee_ids: taskForm.assignee_ids.length > 0 ? taskForm.assignee_ids : undefined,
          parent_task_id: taskForm.parent_task_id || undefined,
          predecessor_task_ids:
            taskForm.predecessor_task_ids.length > 0 ? taskForm.predecessor_task_ids : undefined,
          is_escalation: taskForm.is_escalation,
          escalation_for: taskForm.escalation_for || undefined,
          escalation_sla_hours: taskForm.escalation_sla_hours
            ? parseInt(taskForm.escalation_sla_hours)
            : undefined,
          repeat_every_days: taskForm.repeat_every_days ? parseInt(taskForm.repeat_every_days) : undefined,
        },
      })
      setTaskDialogOpen(false)
      setTaskForm({
        title: '',
        description: '',
        priority: 'medium',
        control_ski: false,
        progress_percent: '0',
        next_step: '',
        start_date: '',
        end_date: '',
        estimated_hours: '',
        assigned_to_id: '',
        assignee_ids: [],
        parent_task_id: '',
        predecessor_task_ids: [],
        is_escalation: false,
        escalation_for: '',
        escalation_sla_hours: '24',
        repeat_every_days: '',
      })
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось создать задачу'))
    }
  }

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    const formData: Record<string, unknown> = {
      name: editForm.name,
      description: editForm.description,
      status: editForm.status,
      priority: editForm.control_ski ? 'critical' : editForm.priority,
      control_ski: editForm.control_ski,
      planning_mode: editForm.planning_mode,
      strict_no_past_start_date: editForm.strict_no_past_start_date,
      strict_no_past_end_date: editForm.strict_no_past_end_date,
      strict_child_within_parent_dates: editForm.strict_child_within_parent_dates,
      launch_basis_text: editForm.launch_basis_text.trim() || null,
      launch_basis_file_id: editForm.launch_basis_file_id || null,
      start_date: editForm.start_date || null,
      end_date: editForm.end_date || null,
      owner_id: canTransferOwnership ? editForm.owner_id || null : project?.owner_id ?? editForm.owner_id,
      completion_checklist: editForm.completion_checklist,
    }

    const endDateChanged = editForm.end_date !== (project?.end_date ?? '') && editForm.end_date
    if (endDateChanged) {
      setPendingProjectFormData(formData)
      setShowProjectDeadlineModal(true)
      return
    }

    setEditOpen(false)
    try {
      await updateProject.mutateAsync({ projectId: id!, data: formData })
    } catch (error: any) {
      setEditOpen(true)
      window.alert(humanizeApiError(error, 'Не удалось сохранить проект'))
    }
  }

  const handleProjectDeadlineConfirm = async (reason: string) => {
    if (!pendingProjectFormData) return
    setShowProjectDeadlineModal(false)
    setEditOpen(false)
    try {
      await updateProject.mutateAsync({
        projectId: id!,
        data: { ...pendingProjectFormData, deadline_change_reason: reason },
      })
      setPendingProjectFormData(null)
    } catch (error: any) {
      setEditOpen(true)
      window.alert(humanizeApiError(error, 'Не удалось сохранить проект'))
    }
  }

  const handleProjectDeadlineCancel = () => {
    setShowProjectDeadlineModal(false)
    setPendingProjectFormData(null)
  }

  const handleDeleteProject = async () => {
    if (!id || !canManage || !canDelete) return
    if (!window.confirm('Удалить проект? Это действие нельзя отменить.')) return
    try {
      await deleteProject.mutateAsync(id)
      navigate('/')
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось удалить проект'))
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

  const handleDownload = async (file: ProjectFile) => {
    const res = await api.downloadProjectFile(id!, file.id)
    const blob = new Blob([res.data], { type: file.content_type || 'application/octet-stream' })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.URL.revokeObjectURL(url)
  }

  const renderTaskContent = (task: Task) => (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={selectedTaskIds.includes(task.id)}
            onChange={() => handleToggleTaskSelection(task.id)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4"
          />
          <button
            onClick={() => handleTaskClick(task)}
            className="text-left hover:text-primary transition-colors"
          >
            <span className="font-medium text-sm">{task.title}</span>
          </button>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[task.priority]}`}
          >
            {task.priority}
          </span>
          {task.is_escalation && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-800">
              эскалация
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {task.assignee && (
            <span className="text-xs text-muted-foreground">{formatUserDisplayName(task.assignee)}</span>
          )}
          <select
            value={task.status}
            onChange={(e) => handleQuickStatusChange(task, e.target.value)}
            className="text-xs border rounded px-2 py-1 bg-background"
          >
            <option value="planning">{STATUS_LABELS.planning}</option>
            <option value="tz">{STATUS_LABELS.tz}</option>
            <option value="todo">{STATUS_LABELS.todo}</option>
            <option value="in_progress">{STATUS_LABELS.in_progress}</option>
            <option value="testing">{STATUS_LABELS.testing}</option>
            <option value="review">{STATUS_LABELS.review}</option>
            <option value="done">{STATUS_LABELS.done}</option>
          </select>
        </div>
      </div>
      <div className="mt-2">
        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary"
            style={{ width: `${Math.max(0, Math.min(100, task.progress_percent ?? 0))}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Прогресс: {task.progress_percent ?? 0}%{task.next_step ? ` · Следующий шаг: ${task.next_step}` : ''}
        </p>
      </div>
      {task.end_date && (
        <p className="text-xs text-muted-foreground mt-1">
          Дедлайн: {new Date(task.end_date).toLocaleDateString()}
        </p>
      )}
    </>
  )

  if (!project) {
    return <div className="p-6 text-muted-foreground">Loading...</div>
  }

  return (
    <div className="p-6">
      {/* Header */}
      <ProjectDetailHeader
        project={project}
        hasLaunchBasis={!!(project.launch_basis_text || launchBasisFile)}
        priorityColorClass={PRIORITY_COLORS[project.control_ski ? 'critical' : project.priority]}
        view={view}
        onViewChange={setView}
        onAiAnalysis={handleAiAnalysis}
        aiAnalysisPending={analyzeProject.isPending}
        canManage={canManage}
        onEditClick={() => setEditOpen(true)}
        canDelete={canManage && canDelete}
        onDeleteClick={handleDeleteProject}
        deletePending={deleteProject.isPending}
        onAddTaskClick={() => setTaskDialogOpen(true)}
      />
      <ProjectEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editForm={editForm}
        setEditForm={setEditForm}
        onSubmit={handleUpdateProject}
        isPending={updateProject.isPending}
        users={users}
        files={files}
        projectId={id!}
        canManage={canManage}
        canTransferOwnership={canTransferOwnership}
      />
      <ProjectTaskCreateDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        taskForm={taskForm}
        setTaskForm={setTaskForm}
        onSubmit={handleCreateTask}
        isPending={createTask.isPending}
        assigneeOptions={projectAssigneeOptions}
        hierarchyOptions={taskHierarchyOptions}
      />

      <ProjectSummaryCard
        projectProgress={projectProgress}
        progressStats={progressStats}
        endDate={project.end_date}
        launchBasisText={project.launch_basis_text}
        launchBasisFile={launchBasisFile}
        deadlineHistory={projectDeadlineHistory}
        showDeadlineHistory={showProjectDeadlineHistory}
        onToggleDeadlineHistory={() => setShowProjectDeadlineHistory(!showProjectDeadlineHistory)}
        onDownload={handleDownload}
      />

      {/* Description */}
      {project.description && (
        <p className="text-muted-foreground text-sm mb-6">{project.description}</p>
      )}

      {/* Content */}
      {view === 'gantt' ? (
        <ProjectDetailGanttSection
          ganttTasks={ganttData?.tasks ?? []}
          criticalPath={criticalPath}
          onTaskClick={handleGanttTaskClick}
        />
      ) : view === 'list' ? (
        <div className="space-y-3">
          <div className="rounded-lg border bg-card p-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <Input
                placeholder="Поиск по задачам..."
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
              />
              <select
                value={taskStatusFilter}
                onChange={(e) => setTaskStatusFilter(e.target.value)}
                className="border rounded px-2 py-2 text-sm bg-background"
              >
                <option value="all">Все статусы</option>
                <option value="planning">Планирование</option>
                <option value="tz">ТЗ</option>
                <option value="todo">К выполнению</option>
                <option value="in_progress">В работе</option>
                <option value="testing">Тестирование</option>
                <option value="review">На проверке</option>
                <option value="done">Выполнено</option>
              </select>
              <select
                value={taskAssigneeFilter}
                onChange={(e) => setTaskAssigneeFilter(e.target.value)}
                className="border rounded px-2 py-2 text-sm bg-background"
              >
                <option value="all">Все исполнители</option>
                <option value="unassigned">Без исполнителя</option>
                {members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {formatUserDisplayName(m.user)}
                  </option>
                ))}
              </select>
              <Button variant="outline" onClick={handleToggleSelectAllVisible}>
                {selectedVisibleCount === filteredTasks.length && filteredTasks.length > 0
                  ? 'Снять выделение'
                  : 'Выделить видимые'}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Выбрано: {selectedTaskIds.length} / Видимых: {filteredTasks.length}
              </span>
              <Button
                variant={hideDone ? 'default' : 'outline'}
                size="sm"
                onClick={() => setHideDone((v) => !v)}
              >
                {hideDone
                  ? `Показать выполненные (${tasks.filter((t) => t.status === 'done').length})`
                  : 'Скрыть выполненные'}
              </Button>
              <select
                value={taskSortBy}
                onChange={(e) => setTaskSortBy(e.target.value as 'order' | 'status' | 'priority')}
                className="border rounded px-2 py-1 text-sm bg-background"
              >
                <option value="order">Сортировка: по порядку</option>
                <option value="status">Сортировка: по статусу</option>
                <option value="priority">Сортировка: по приоритету</option>
              </select>
              <select
                value={taskSortDir}
                onChange={(e) => setTaskSortDir(e.target.value as 'asc' | 'desc')}
                className="border rounded px-2 py-1 text-sm bg-background"
              >
                <option value="asc">По возрастанию</option>
                <option value="desc">По убыванию</option>
              </select>
              <select
                value={taskRowSize}
                onChange={(e) => setTaskRowSize(e.target.value as 'compact' | 'normal' | 'comfortable')}
                className="border rounded px-2 py-1 text-sm bg-background"
              >
                <option value="compact">Плотность: компактно</option>
                <option value="normal">Плотность: обычная</option>
                <option value="comfortable">Плотность: свободно</option>
              </select>
              {canManage && canBulkEdit && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkStatusUpdate('tz')}
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                  >
                    В ТЗ
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkStatusUpdate('planning')}
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                  >
                    В планирование
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkStatusUpdate('in_progress')}
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                  >
                    В работу
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkStatusUpdate('review')}
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                  >
                    На проверку
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkStatusUpdate('testing')}
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                  >
                    В тестирование
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkStatusUpdate('done')}
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                  >
                    Завершить
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleBulkDelete}
                    disabled={selectedTaskIds.length === 0 || bulkBusy || !canDelete}
                  >
                    Удалить выбранные
                  </Button>
                  <select
                    value={bulkAssignee}
                    onChange={(e) => setBulkAssignee(e.target.value)}
                    className="border rounded px-2 py-1 text-sm bg-background"
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                  >
                    <option value="keep">Исполнитель: без изменений</option>
                    <option value="unassigned">Исполнитель: снять назначение</option>
                    {members.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        Исполнитель: {formatUserDisplayName(m.user)}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkAssign}
                    disabled={selectedTaskIds.length === 0 || bulkBusy || bulkAssignee === 'keep'}
                  >
                    Применить исполнителя
                  </Button>
                  <select
                    value={bulkPriority}
                    onChange={(e) => setBulkPriority(e.target.value)}
                    className="border rounded px-2 py-1 text-sm bg-background"
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                  >
                    <option value="keep">Приоритет: без изменений</option>
                    <option value="low">Низкий</option>
                    <option value="medium">Средний</option>
                    <option value="high">Высокий</option>
                    <option value="critical">Критический</option>
                    <option value="ski">Контроль СКИ (critical)</option>
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkPriority}
                    disabled={selectedTaskIds.length === 0 || bulkBusy || bulkPriority === 'keep'}
                  >
                    Применить приоритет
                  </Button>
                  {/* Deadline shift */}
                  <input
                    type="number"
                    placeholder="Дней (±)"
                    value={bulkShiftDays}
                    onChange={(e) => setBulkShiftDays(e.target.value)}
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                    className="border rounded px-2 py-1 text-sm bg-background w-24"
                  />
                  <input
                    type="text"
                    placeholder="Причина сдвига"
                    value={bulkShiftReason}
                    onChange={(e) => setBulkShiftReason(e.target.value)}
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                    className="border rounded px-2 py-1 text-sm bg-background w-40"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkShiftDeadline}
                    disabled={selectedTaskIds.length === 0 || bulkBusy || !bulkShiftDays || !bulkShiftReason.trim()}
                  >
                    Сдвинуть дедлайн
                  </Button>
                  {/* Move to project */}
                  <select
                    value={bulkMoveProjectId}
                    onChange={(e) => setBulkMoveProjectId(e.target.value)}
                    className="border rounded px-2 py-1 text-sm bg-background"
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                  >
                    <option value="">Перенести в проект...</option>
                    {allProjects
                      .filter((p) => p.id !== id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkMoveToProject}
                    disabled={selectedTaskIds.length === 0 || bulkBusy || !bulkMoveProjectId}
                  >
                    Перенести
                  </Button>
                </>
              )}
            </div>
          </div>

          <TaskTable
            tasks={filteredTasks}
            allTasks={tasks}
            onTaskClick={handleTaskClick}
            hasChildrenIds={hasChildrenIds}
            collapsedTaskIds={collapsedTaskIds}
            onToggleCollapse={toggleCollapse}
            onReorder={taskSortBy === 'order' ? handleReorder : undefined}
            onStatusChange={(taskId, status) => {
              const task = tasks.find((t) => t.id === taskId)
              if (task) handleQuickStatusChange(task, status)
            }}
            shiftsMap={shiftsMap}
            rowSize={taskRowSize}
            externalDepsMap={projectExternalDeps}
            isFetching={tasksFetching}
          />
        </div>
      ) : view === 'members' ? (
        <MembersPanel projectId={id!} />
      ) : view === 'graph' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Граф зависимостей между задачами проекта. Красная рамка — критический путь. Стрелки показывают порядок выполнения (FS / SS / FF).
          </p>
          {depGraph ? (
            <DependencyGraphView graph={depGraph} />
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Загрузка...</div>
          )}
        </div>
      ) : showTime ? (
        <TimeTrackingPanel projectId={id!} />
      ) : (
        <ProjectDetailFilesSection
          projectId={id!}
          canImport={canImport}
          canManage={canManage}
          onDownload={handleDownload}
        />
      )}


      <TaskDrawer
        task={selectedTask}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        projectId={id!}
      />

      <DeadlineReasonModal
        open={showProjectDeadlineModal}
        oldDate={project?.end_date ?? ''}
        newDate={(pendingProjectFormData?.end_date as string) ?? ''}
        onConfirm={handleProjectDeadlineConfirm}
        onCancel={handleProjectDeadlineCancel}
      />

      {/* AI Analysis modal */}
      {showAiAnalysis && aiAnalysisResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-primary" />
                <span className="font-semibold">AI-анализ проекта</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>Задач: {aiAnalysisResult.stats.total_tasks}</span>
                  <span>Выполнено: {aiAnalysisResult.stats.done_percent}%</span>
                  {aiAnalysisResult.stats.overdue_count > 0 && (
                    <span className="text-destructive">Просрочено: {aiAnalysisResult.stats.overdue_count}</span>
                  )}
                  {aiAnalysisResult.stats.stale_count > 0 && (
                    <span className="text-yellow-600">Зависших: {aiAnalysisResult.stats.stale_count}</span>
                  )}
                </div>
                <button onClick={() => setShowAiAnalysis(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-5 py-4 flex-1">
              <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{aiAnalysisResult.analysis}</pre>
            </div>
            <div className="px-5 py-3 border-t text-xs text-muted-foreground">
              Сгенерировано: {new Date(aiAnalysisResult.generated_at).toLocaleString('ru-RU')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
