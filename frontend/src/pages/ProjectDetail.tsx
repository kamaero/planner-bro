import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
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
  useProjectFiles,
  useUploadProjectFile,
  useDeleteProjectFile,
  useImportMSProjectTasks,
  useAIJobs,
  useStartAIProcessing,
  useAIDrafts,
  useApproveAIDraft,
  useApproveAIDraftsBulk,
  useRejectAIDraft,
  useRejectAIDraftsBulk,
  useProjectDeadlineHistory,
} from '@/hooks/useProjects'
import { useMembers } from '@/hooks/useMembers'
import { useUsers } from '@/hooks/useUsers'
import { api } from '@/api/client'
import { GanttChart } from '@/components/GanttChart/GanttChart'
import { TaskDrawer } from '@/components/TaskDrawer/TaskDrawer'
import { MembersPanel } from '@/components/MembersPanel/MembersPanel'
import { TaskTable } from '@/components/TaskTable/TaskTable'
import { DeadlineReasonModal } from '@/components/DeadlineReasonModal/DeadlineReasonModal'
import { AssigneePicker } from '@/components/AssigneePicker/AssigneePicker'
import { TaskRelationPicker } from '@/components/TaskRelationPicker/TaskRelationPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  PROJECT_STATUS_OPTIONS,
  TASK_PRIORITY_BADGE_COLORS,
  TASK_PRIORITY_ORDER,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
} from '@/lib/domainMeta'
import { humanizeApiError } from '@/lib/errorMessages'
import { buildTaskHierarchy, parseTaskOrderFromTitle } from '@/lib/taskOrdering'
import { formatUserDisplayName } from '@/lib/userName'
import type { Task, GanttTask, ProjectFile, ImportFilePrecheck, AITaskDraft } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { ArrowLeft, Plus, BarChart2, List, Users, Pencil, Paperclip, Download, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'

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
  const { data: ganttData } = useGantt(id!)
  const { data: criticalPath } = useCriticalPath(id!)
  const { data: tasks = [] } = useTasks(id!)
  const { data: members = [] } = useMembers(id!)
  const { data: users = [] } = useUsers()
  const { data: files = [] } = useProjectFiles(id!)
  const { data: aiJobs = [] } = useAIJobs(id!)
  const startAIProcessing = useStartAIProcessing()
  const { data: aiDrafts = [] } = useAIDrafts(id!, 'pending')
  const createTask = useCreateTask()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const updateTaskStatus = useUpdateTaskStatus()
  const bulkUpdateTasks = useBulkUpdateTasks()
  const uploadProjectFile = useUploadProjectFile()
  const importMSProjectTasks = useImportMSProjectTasks()
  const deleteProjectFile = useDeleteProjectFile()
  const approveAIDraft = useApproveAIDraft()
  const approveAIDraftsBulk = useApproveAIDraftsBulk()
  const rejectAIDraft = useRejectAIDraft()
  const rejectAIDraftsBulk = useRejectAIDraftsBulk()
  const currentUser = useAuthStore((s) => s.user)

  const [view, setView] = useState<'gantt' | 'list' | 'members' | 'files'>('list')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [fileToUpload, setFileToUpload] = useState<File | null>(null)
  const [msProjectFile, setMSProjectFile] = useState<File | null>(null)
  const [replaceExistingMSImport, setReplaceExistingMSImport] = useState(true)
  const [taskForm, setTaskForm] = useState({
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
  const [editForm, setEditForm] = useState({
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
  const [taskSortBy, setTaskSortBy] = useState<'order' | 'status' | 'priority'>('order')
  const [taskSortDir, setTaskSortDir] = useState<'asc' | 'desc'>('asc')
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkAssignee, setBulkAssignee] = useState('keep')
  const [bulkPriority, setBulkPriority] = useState('keep')
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([])
  const [aiPromptInstruction, setAIPromptInstruction] = useState('')
  const [fileImportPrechecks, setFileImportPrechecks] = useState<Record<string, ImportFilePrecheck>>({})
  const [showProjectDeadlineModal, setShowProjectDeadlineModal] = useState(false)
  const [pendingProjectFormData, setPendingProjectFormData] = useState<Record<string, unknown> | null>(null)
  const [showProjectDeadlineHistory, setShowProjectDeadlineHistory] = useState(false)
  const [taskRowSize, setTaskRowSize] = useState<'compact' | 'normal' | 'comfortable'>('normal')

  const { data: projectDeadlineHistory = [] } = useProjectDeadlineHistory(id)
  // shiftsMap is empty here — per-task shift counts are shown inside TaskDrawer
  // when the user opens a task. Table shows shift indicator only when shifts data is available.
  const shiftsMap = useMemo(() => ({} as Record<string, number>), [])

  const memberRole = members.find((m) => m.user.id === currentUser?.id)?.role
  const canManage = currentUser?.role === 'admin' || memberRole === 'owner' || memberRole === 'manager'
  const canRenameProject =
    canManage ||
    currentUser?.role === 'manager' ||
    !!currentUser?.can_manage_team ||
    currentUser?.visibility_scope === 'department_scope'
  const canTransferOwnership = currentUser?.role === 'admin' || memberRole === 'owner'
  const canDelete = currentUser?.role === 'admin' || !!currentUser?.can_delete
  const canImport = currentUser?.role === 'admin' || !!currentUser?.can_import
  const canBulkEdit = currentUser?.role === 'admin' || !!currentUser?.can_bulk_edit
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
  const importFilePrecheck = useMemo(() => {
    if (!msProjectFile) return null
    const name = msProjectFile.name.toLowerCase()
    const isXlsx = name.endsWith('.xlsx')
    const isXml = name.endsWith('.xml')
    const isMpp = name.endsWith('.mpp')
    return {
      isXlsx,
      isXml,
      isMpp,
      messages: [
        isXlsx
          ? 'Таблица XLSX выбрана. Лучше всего сработают явные колонки: Наименование, Срок, Исполнитель, Заказчик, Вид задачи.'
          : null,
        isXml
          ? 'XML выбран. Для импорта структуры это предпочтительный формат MS Project.'
          : null,
        isMpp
          ? 'MPP выбран. Если импорт даст нестабильный результат, лучше выгрузить XML/MSPDI.'
          : null,
        !isXlsx && !isXml && !isMpp
          ? 'Формат выглядит нестандартно для импорта задач. Лучше использовать XML/MSPDI, MPP или XLSX.'
          : null,
      ].filter(Boolean) as string[],
    }
  }, [msProjectFile])

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
  }, [tasks, taskSearch, taskStatusFilter, taskAssigneeFilter, taskSortBy, taskSortDir])

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

  useEffect(() => {
    let cancelled = false
    const xlsxFiles = files.filter((file) => file.filename.toLowerCase().endsWith('.xlsx'))
    if (!id || xlsxFiles.length === 0) {
      setFileImportPrechecks({})
      return () => {
        cancelled = true
      }
    }

    void Promise.all(
      xlsxFiles.map(async (file) => {
        try {
          const precheck = (await api.getImportFilePrecheck(id, file.id)) as ImportFilePrecheck
          return [file.id, precheck] as const
        } catch {
          return [
            file.id,
            {
              file_type: 'xlsx',
              detected_headers: [],
              recognized_columns: [],
              missing_columns: [],
              warnings: ['Не удалось проверить структуру XLSX до запуска ИИ.'],
              can_start_ai: true,
            } satisfies ImportFilePrecheck,
          ] as const
        }
      })
    ).then((entries) => {
      if (cancelled) return
      setFileImportPrechecks(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [files, id])

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

  useEffect(() => {
    const ids = new Set(aiDrafts.map((d) => d.id))
    setSelectedDraftIds((prev) => prev.filter((id) => ids.has(id)))
  }, [aiDrafts])

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
    const formData: Record<string, unknown> = canManage
      ? {
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
      : {
          name: editForm.name,
        }

    const endDateChanged = editForm.end_date !== (project?.end_date ?? '') && editForm.end_date
    if (canManage && endDateChanged) {
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

  const handleUploadFile = async () => {
    if (!fileToUpload) return
    try {
      await uploadProjectFile.mutateAsync({ projectId: id!, file: fileToUpload })
      setFileToUpload(null)
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось загрузить файл'))
    }
  }

  const handleImportMSProject = async () => {
    if (!msProjectFile) return
    try {
      const result = await importMSProjectTasks.mutateAsync({
        projectId: id!,
        file: msProjectFile,
        replaceExisting: replaceExistingMSImport,
      })
      setMSProjectFile(null)
      window.alert(
        `Импорт завершен.\nСоздано: ${result.created}\nСвязано с родителем: ${result.linked_to_parent}\nУдалено старых импортированных: ${result.deleted_existing}\nПропущено: ${result.skipped}`
      )
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось импортировать задачи из MS Project'))
    }
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

  const latestJobByFile = useMemo(() => {
    const map: Record<string, (typeof aiJobs)[number]> = {}
    aiJobs.forEach((job) => {
      const existing = map[job.project_file_id]
      if (!existing || existing.created_at < job.created_at) {
        map[job.project_file_id] = job
      }
    })
    return map
  }, [aiJobs])

  const getAIStatusMeta = (status?: string) => {
    if (status === 'processing') return { label: 'В обработке', percent: 60, bar: 'bg-blue-500' }
    if (status === 'completed') return { label: 'Готово', percent: 100, bar: 'bg-emerald-500' }
    if (status === 'failed') return { label: 'Ошибка', percent: 100, bar: 'bg-red-500' }
    if (status === 'queued') return { label: 'В очереди', percent: 15, bar: 'bg-amber-500' }
    return { label: 'Нет задачи AI', percent: 0, bar: 'bg-muted-foreground' }
  }

  const getDraftAssigneeMeta = (draft: AITaskDraft) => {
    const payload = draft.raw_payload ?? {}
    const assigneeHints = Array.isArray(payload.assignee_hints)
      ? payload.assignee_hints.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : draft.assignee_hint
        ? [draft.assignee_hint]
        : []
    const matchedAssigneeIds = Array.isArray(payload.matched_assignee_ids)
      ? payload.matched_assignee_ids.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : draft.assigned_to_id
        ? [draft.assigned_to_id]
        : []

    if (matchedAssigneeIds.length > 0 && assigneeHints.length > matchedAssigneeIds.length) {
      return {
        label: `Частично распознан: ${matchedAssigneeIds.length} из ${assigneeHints.length}`,
        tone: 'border-amber-200 bg-amber-50 text-amber-700',
      }
    }
    if (matchedAssigneeIds.length > 0) {
      return {
        label: draft.assignee
          ? `Распознан: ${formatUserDisplayName(draft.assignee)}`
          : 'Исполнитель распознан точно',
        tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      }
    }
    if (assigneeHints.length > 0) {
      return {
        label: `Временное имя: ${assigneeHints.join(', ')}`,
        tone: 'border-orange-200 bg-orange-50 text-orange-700',
      }
    }
    return {
      label: 'Исполнитель не указан',
      tone: 'border-slate-200 bg-slate-50 text-slate-600',
    }
  }

  const handleApproveDraft = async (draftId: string) => {
    await approveAIDraft.mutateAsync({ projectId: id!, draftId })
  }

  const handleRejectDraft = async (draftId: string) => {
    await rejectAIDraft.mutateAsync({ projectId: id!, draftId })
  }

  const handleApproveSelectedDrafts = async () => {
    if (selectedDraftIds.length === 0) return
    await approveAIDraftsBulk.mutateAsync({ projectId: id!, draftIds: selectedDraftIds })
    setSelectedDraftIds([])
  }

  const handleRejectSelectedDrafts = async () => {
    if (selectedDraftIds.length === 0) return
    if (!window.confirm(`Удалить выбранные черновики (${selectedDraftIds.length})?`)) return
    await rejectAIDraftsBulk.mutateAsync({ projectId: id!, draftIds: selectedDraftIds })
    setSelectedDraftIds([])
  }

  const allDraftsSelected = aiDrafts.length > 0 && aiDrafts.every((d) => selectedDraftIds.includes(d.id))

  const handleToggleAllDrafts = () => {
    if (allDraftsSelected) {
      setSelectedDraftIds([])
      return
    }
    setSelectedDraftIds(aiDrafts.map((d) => d.id))
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
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${TASK_PRIORITY_BADGE_COLORS[task.priority]}`}
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
            <option value="planning">{TASK_STATUS_LABELS.planning}</option>
            <option value="tz">{TASK_STATUS_LABELS.tz}</option>
            <option value="todo">{TASK_STATUS_LABELS.todo}</option>
            <option value="in_progress">{TASK_STATUS_LABELS.in_progress}</option>
            <option value="testing">{TASK_STATUS_LABELS.testing}</option>
            <option value="review">{TASK_STATUS_LABELS.review}</option>
            <option value="done">{TASK_STATUS_LABELS.done}</option>
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
      <div className="flex items-center gap-4 mb-6">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2 flex-1">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color }} />
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <Badge variant="secondary">{project.status}</Badge>
          <Badge variant="outline">
            {project.planning_mode === 'strict' ? 'strict' : 'flexible'}
          </Badge>
          <Badge variant="outline" className={TASK_PRIORITY_BADGE_COLORS[project.control_ski ? 'critical' : project.priority]}>
            {project.control_ski ? 'critical · СКИ' : project.priority}
          </Badge>
          {(project.launch_basis_text || launchBasisFile) && (
            <Badge variant="outline">Основание запуска</Badge>
          )}
        </div>

        <div className="flex gap-1">
          <Button
            variant={view === 'gantt' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('gantt')}
          >
            <BarChart2 className="w-4 h-4 mr-1" />
            Gantt
          </Button>
          <Button
            variant={view === 'list' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('list')}
          >
            <List className="w-4 h-4 mr-1" />
            List
          </Button>
          <Button
            variant={view === 'members' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('members')}
          >
            <Users className="w-4 h-4 mr-1" />
            Members
          </Button>
          <Button
            variant={view === 'files' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('files')}
          >
            <Paperclip className="w-4 h-4 mr-1" />
            Files
          </Button>
        </div>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={!canRenameProject}>
              <Pencil className="w-4 h-4 mr-1" />
              Редактировать
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[95vw] max-w-5xl max-h-[88vh]">
            <DialogHeader>
              <DialogTitle>Редактировать проект</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpdateProject} className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto max-h-[72vh] pr-1">
              {!canManage && (
                <div className="lg:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  У вас открыт упрощённый режим: можно корректировать только название проекта. Остальные поля доступны владельцу проекта, менеджеру проекта или администратору.
                </div>
              )}
              <div className="lg:col-span-2 rounded-xl border bg-muted/30 p-3">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Статус</p>
                    <p className="text-sm font-semibold">{PROJECT_STATUS_OPTIONS.find((item) => item.value === editForm.status)?.label ?? editForm.status}</p>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Дедлайн</p>
                    <p className="text-sm font-semibold">{editForm.end_date ? new Date(editForm.end_date).toLocaleDateString('ru-RU') : 'Не задан'}</p>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Прогресс проекта</p>
                    <p className="text-sm font-semibold">{projectProgress}%</p>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Задачи</p>
                    <p className="text-sm font-semibold">{progressStats.completedCount} / {progressStats.totalCount} выполнено</p>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Ответственный</p>
                    <p className="text-sm font-semibold">
                      {formatUserDisplayName(users.find((u) => u.id === editForm.owner_id) ?? project.owner)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Название</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Описание</Label>
                <Input
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  disabled={!canManage}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Статус</Label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full border rounded px-2 py-2 bg-background text-sm"
                    disabled={!canManage}
                  >
                    {PROJECT_STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Режим планирования</Label>
                    <select
                      value={editForm.planning_mode}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          planning_mode: e.target.value as 'flexible' | 'strict',
                        }))
                      }
                      className="w-full border rounded px-2 py-2 bg-background text-sm"
                      disabled={!canManage}
                    >
                    <option value="flexible">Гибкий</option>
                    <option value="strict">Строгий</option>
                  </select>
                  <div className="mt-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-foreground">Как выбрать режим</p>
                      <Link
                        to="/help#planning-modes"
                        className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                      >
                        Подробнее
                      </Link>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <p><span className="font-medium text-foreground">Гибкий</span> — для живых рабочих списков без жёсткой валидации.</p>
                      <p><span className="font-medium text-foreground">Строгий</span> — для управляемых проектов с правилами дат и зависимостей.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Приоритет</Label>
                  <div className="flex items-center gap-3">
                    <select
                      value={editForm.control_ski ? 'critical' : editForm.priority}
                      onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}
                      className="w-full border rounded px-2 py-2 bg-background text-sm"
                      disabled={!canManage || editForm.control_ski}
                    >
                      <option value="low">Низкий</option>
                      <option value="medium">Средний</option>
                      <option value="high">Высокий</option>
                      <option value="critical">Критический</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                      <span>Контроль СКИ</span>
                      <Switch
                        checked={editForm.control_ski}
                        onCheckedChange={(checked) =>
                          setEditForm((f) => ({
                            ...f,
                            control_ski: checked,
                            priority: checked ? 'critical' : f.priority,
                          }))
                        }
                        disabled={!canManage}
                      />
                    </label>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Ответственный</Label>
                  <select
                    value={editForm.owner_id}
                    onChange={(e) => setEditForm((f) => ({ ...f, owner_id: e.target.value }))}
                    className="w-full border rounded px-2 py-2 bg-background text-sm"
                    disabled={!canTransferOwnership || !canManage}
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {formatUserDisplayName(u)} ({u.role})
                      </option>
                    ))}
                  </select>
                  {!canTransferOwnership && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Только владелец проекта или администратор может менять ответственного.
                    </p>
                  )}
                </div>
              </div>
              {editForm.planning_mode === 'strict' && (
                <div className="rounded border bg-muted/20 p-3 space-y-2 lg:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">Правила строгого режима</p>
                    <Link
                      to="/help#planning-modes"
                      className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                    >
                      Как это работает
                    </Link>
                  </div>
                  <label className="flex items-center justify-between gap-2 text-sm">
                    <span>Запрет даты начала в прошлом</span>
                    <Switch
                      checked={editForm.strict_no_past_start_date}
                      onCheckedChange={(checked) =>
                        setEditForm((f) => ({ ...f, strict_no_past_start_date: checked }))
                      }
                      disabled={!canManage}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 text-sm">
                    <span>Запрет дедлайна в прошлом</span>
                    <Switch
                      checked={editForm.strict_no_past_end_date}
                      onCheckedChange={(checked) =>
                        setEditForm((f) => ({ ...f, strict_no_past_end_date: checked }))
                      }
                      disabled={!canManage}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 text-sm">
                    <span>Дочерняя задача в диапазоне дат родителя</span>
                    <Switch
                      checked={editForm.strict_child_within_parent_dates}
                      onCheckedChange={(checked) =>
                        setEditForm((f) => ({ ...f, strict_child_within_parent_dates: checked }))
                      }
                      disabled={!canManage}
                    />
                  </label>
                </div>
              )}

              <div className="space-y-1 lg:col-span-2">
                <Label>Основание запуска</Label>
                <Input
                  value={editForm.launch_basis_text}
                  onChange={(e) => setEditForm((f) => ({ ...f, launch_basis_text: e.target.value }))}
                  placeholder="Напр.: Приказ #111222333 24.02.2026"
                  disabled={!canManage}
                />
              </div>

              <div className="space-y-1 lg:col-span-2">
                <Label>Файл основания запуска</Label>
                <select
                  value={editForm.launch_basis_file_id}
                  onChange={(e) => setEditForm((f) => ({ ...f, launch_basis_file_id: e.target.value }))}
                  className="w-full border rounded px-2 py-2 bg-background text-sm"
                  disabled={!canManage}
                >
                  <option value="">—</option>
                  {files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.filename}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Дата начала</Label>
                  <Input
                    type="date"
                    value={editForm.start_date}
                    onChange={(e) => setEditForm((f) => ({ ...f, start_date: e.target.value }))}
                    disabled={!canManage}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Дата окончания</Label>
                  <Input
                    type="date"
                    value={editForm.end_date}
                    onChange={(e) => setEditForm((f) => ({ ...f, end_date: e.target.value }))}
                    disabled={!canManage}
                  />
                </div>
              </div>
              <div className="space-y-2 rounded-lg border p-3 lg:col-span-2">
                <Label className="text-sm font-semibold">Definition of Done (обязательный чеклист)</Label>
                <div className="space-y-2">
                  {editForm.completion_checklist.map((item) => (
                    <label key={item.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            completion_checklist: prev.completion_checklist.map((current) =>
                              current.id === item.id ? { ...current, done: e.target.checked } : current
                            ),
                          }))
                        }
                        disabled={!canManage}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
                {editForm.status === 'completed' &&
                  editForm.completion_checklist.some((i) => !i.done) && (
                    <p className="text-xs text-red-600">
                      Чтобы завершить проект, отметьте все пункты чеклиста.
                    </p>
                  )}
              </div>
              <Button type="submit" className="w-full lg:col-span-2" disabled={updateProject.isPending}>
                {updateProject.isPending ? 'Сохранение...' : 'Сохранить изменения'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        {canManage && canDelete && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteProject}
            disabled={deleteProject.isPending}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            {deleteProject.isPending ? 'Удаление...' : 'Удалить проект'}
          </Button>
        )}

        <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" />
              Добавить задачу
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[95vw] max-w-5xl max-h-[88vh]">
            <DialogHeader>
              <DialogTitle>Создать задачу</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateTask} className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto max-h-[72vh] pr-1">
              <div className="space-y-1 lg:col-span-2">
                <Label>Название</Label>
                <Input
                  value={taskForm.title}
                  onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))}
                  required
                  placeholder="Название задачи"
                />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <Label>Описание</Label>
                <Input
                  value={taskForm.description}
                  onChange={(e) => setTaskForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Необязательно"
                />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <Label>Приоритет</Label>
                <div className="flex items-center gap-3">
                  <select
                    value={taskForm.control_ski ? 'critical' : taskForm.priority}
                    onChange={(e) => setTaskForm((f) => ({ ...f, priority: e.target.value }))}
                    className="w-full border rounded px-3 py-2 text-sm bg-background"
                    disabled={taskForm.control_ski}
                  >
                    <option value="low">Низкий</option>
                    <option value="medium">Средний</option>
                    <option value="high">Высокий</option>
                    <option value="critical">Критический</option>
                  </select>
                  <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                    <span>Контроль СКИ</span>
                    <Switch
                      checked={taskForm.control_ski}
                      onCheckedChange={(checked) =>
                        setTaskForm((f) => ({
                          ...f,
                          control_ski: checked,
                          priority: checked ? 'critical' : f.priority,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Прогресс, %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={taskForm.progress_percent}
                    onChange={(e) => setTaskForm((f) => ({ ...f, progress_percent: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Следующий шаг</Label>
                  <Input
                    value={taskForm.next_step}
                    onChange={(e) => setTaskForm((f) => ({ ...f, next_step: e.target.value }))}
                    placeholder="Необязательно"
                  />
                </div>
              </div>
              <div className="space-y-1 lg:col-span-2">
                <Label>Исполнители</Label>
                <AssigneePicker
                  users={projectAssigneeOptions}
                  value={taskForm.assignee_ids}
                  onChange={(values) =>
                    setTaskForm((f) => ({ ...f, assignee_ids: values, assigned_to_id: values[0] ?? '' }))
                  }
                  placeholder="Поиск по имени, почте или должности"
                />
                <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">Подсказка по назначению</p>
                    <Link
                      to="/help#assignment-policy"
                      className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                    >
                      Политика назначений
                    </Link>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    <p>1. Можно выбрать сразу нескольких исполнителей через поиск и чекбоксы.</p>
                    <p>2. Если нужного человека нет в списке, проверьте роль, отдел и политику видимости.</p>
                    <p>3. Для кросс-отдельских назначений чаще нужны роли руководителя, администратора, ГИПа или ЗАМа.</p>
                  </div>
                </div>
              </div>
              <div className="space-y-1 lg:col-span-2">
                <Label>Родительская задача (структура)</Label>
                  <TaskRelationPicker
                    tasks={taskHierarchyOptions.ordered}
                    depthById={taskHierarchyOptions.depthById}
                    value={taskForm.parent_task_id}
                    onChange={(next) => setTaskForm((f) => ({ ...f, parent_task_id: String(next) }))}
                    emptyLabel="Без родителя"
                    placeholder="Найти родительскую задачу"
                  />
                <p className="text-xs text-muted-foreground">
                  Parent задаёт только структуру. Для запрета старта используйте поле ниже.{' '}
                  <Link to="/help#dependencies" className="font-medium text-primary hover:text-primary/80">
                    Подробнее
                  </Link>
                </p>
              </div>
              <div className="space-y-1">
                <Label>Зависит от (блокировка старта)</Label>
                <TaskRelationPicker
                  tasks={taskHierarchyOptions.ordered}
                  depthById={taskHierarchyOptions.depthById}
                  value={taskForm.predecessor_task_ids}
                  onChange={(next) => setTaskForm((f) => ({ ...f, predecessor_task_ids: next as string[] }))}
                  multiple
                  emptyLabel="Предшественников пока нет"
                  placeholder="Найти предшествующую задачу"
                />
                <p className="text-xs text-muted-foreground">
                  Эти задачи должны быть в статусе "Выполнено", прежде чем новая задача перейдет в работу.
                </p>
                <p className="text-xs text-muted-foreground">
                  Для продвинутых типов связей `FS / SS / FF` используйте редактирование уже созданной задачи.{' '}
                  <Link to="/help#dependencies" className="font-medium text-primary hover:text-primary/80">
                    Подробнее
                  </Link>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Дата начала</Label>
                  <Input
                    type="date"
                    value={taskForm.start_date}
                    onChange={(e) => setTaskForm((f) => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Дедлайн</Label>
                  <Input
                    type="date"
                    value={taskForm.end_date}
                    onChange={(e) => setTaskForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Оценка часов</Label>
                <Input
                  type="number"
                  value={taskForm.estimated_hours}
                  onChange={(e) => setTaskForm((f) => ({ ...f, estimated_hours: e.target.value }))}
                  placeholder="например, 8"
                />
              </div>
              <div className="space-y-1">
                <Label>Повторять каждые (дней)</Label>
                <Input
                  type="number"
                  value={taskForm.repeat_every_days}
                  onChange={(e) => setTaskForm((f) => ({ ...f, repeat_every_days: e.target.value }))}
                  placeholder="например, 7"
                />
              </div>
              <label className="flex items-center gap-2 text-sm lg:col-span-2">
                <input
                  type="checkbox"
                  checked={taskForm.is_escalation}
                  onChange={(e) => setTaskForm((f) => ({ ...f, is_escalation: e.target.checked }))}
                />
                Эскалация на руководителя
              </label>
              {taskForm.is_escalation && (
                <div className="space-y-1 lg:col-span-2">
                  <Label>Причина эскалации</Label>
                  <Input
                    value={taskForm.escalation_for}
                    onChange={(e) => setTaskForm((f) => ({ ...f, escalation_for: e.target.value }))}
                    placeholder="Что заблокировано и какое решение нужно"
                  />
                  <Label className="pt-2">SLA реакции (часы)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={taskForm.escalation_sla_hours}
                    onChange={(e) =>
                      setTaskForm((f) => ({
                        ...f,
                        escalation_sla_hours: e.target.value,
                      }))
                    }
                    placeholder="24"
                  />
                </div>
              )}
              <Button type="submit" className="w-full lg:col-span-2" disabled={createTask.isPending}>
                {createTask.isPending ? 'Создание...' : 'Создать задачу'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border bg-card p-4 mb-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-sm font-semibold">Прогресс проекта: {projectProgress}%</div>
            <div className="text-sm text-muted-foreground">Выполнено 100%: {progressStats.completedCount}</div>
            <div className="text-sm text-muted-foreground">Без движения (0%): {progressStats.zeroProgressCount}</div>
            <div className="text-sm text-muted-foreground">Всего задач: {progressStats.totalCount}</div>
            {project.end_date && (
              <div className="text-sm text-muted-foreground flex items-center gap-1">
                Дедлайн: {new Date(project.end_date).toLocaleDateString('ru-RU')}
                {projectDeadlineHistory.length > 0 && (
                  <span className="text-xs text-amber-600 font-medium ml-1">
                    (переносился {projectDeadlineHistory.length}×)
                  </span>
                )}
              </div>
            )}
            {(project.launch_basis_text || launchBasisFile) && (
              <div className="text-sm text-muted-foreground">
                {project.launch_basis_text ? project.launch_basis_text : ''}
              </div>
            )}
          </div>
          {launchBasisFile && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleDownload(launchBasisFile)}
            >
              <Download className="w-4 h-4 mr-1" />
              Скачать основание
            </Button>
          )}
        </div>
        <div className="mt-3 h-2 w-full bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${projectProgress}%` }} />
        </div>

        {projectDeadlineHistory.length > 0 && (
          <div className="mt-3 rounded border bg-muted/30">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowProjectDeadlineHistory(!showProjectDeadlineHistory)}
            >
              <span>История переносов дедлайна проекта ({projectDeadlineHistory.length})</span>
              {showProjectDeadlineHistory ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
            {showProjectDeadlineHistory && (
              <div className="px-3 pb-2 space-y-1.5 border-t">
                {projectDeadlineHistory.map((change) => (
                  <div key={change.id} className="pt-2 text-xs">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>
                        {new Date(change.created_at).toLocaleDateString('ru-RU')}
                        {change.changed_by && ` · ${formatUserDisplayName(change.changed_by)}`}
                      </span>
                      <span>
                        {new Date(change.old_date).toLocaleDateString('ru-RU')} →{' '}
                        {new Date(change.new_date).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                    <p className="text-foreground mt-0.5 italic">"{change.reason}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Description */}
      {project.description && (
        <p className="text-muted-foreground text-sm mb-6">{project.description}</p>
      )}

      {/* Content */}
      {view === 'gantt' ? (
        <div className="space-y-3">
          <div className="rounded-xl border bg-card p-4 overflow-x-auto">
            <GanttChart
              tasks={ganttData?.tasks ?? []}
              onTaskClick={handleGanttTaskClick}
            />
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-sm font-semibold mb-2">Critical Path</p>
            {!criticalPath || criticalPath.task_ids.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет зависимостей для расчёта.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {criticalPath.tasks.map((t) => (
                  <span key={t.id} className="text-xs px-2 py-1 rounded border bg-background">
                    {t.title}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : view === 'list' ? (
        <div className="space-y-3">
          <div className="sticky top-3 z-20 rounded-lg border bg-card/95 p-3 space-y-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
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
                </>
              )}
            </div>
          </div>

          <TaskTable
            tasks={filteredTasks}
            allTasks={tasks}
            onTaskClick={handleTaskClick}
            onStatusChange={(taskId, status) => {
              const task = tasks.find((t) => t.id === taskId)
              if (task) handleQuickStatusChange(task, status)
            }}
            shiftsMap={shiftsMap}
            rowSize={taskRowSize}
          />
        </div>
      ) : view === 'members' ? (
        <MembersPanel projectId={id!} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Input
                type="file"
                onChange={(e) => setFileToUpload(e.target.files?.[0] ?? null)}
              />
              <Button
                variant="outline"
                onClick={handleUploadFile}
                disabled={!fileToUpload || uploadProjectFile.isPending || !canImport}
              >
                {uploadProjectFile.isPending ? 'Загрузка...' : 'Загрузить файл'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Единая загрузка: XML/MSPDI, PDF, DOC/DOCX, PPTX, XLSX и текстовые форматы. После обработки черновиков
              файл автоматически переносится в зашифрованное Хранилище (`Processed`) или его можно удалить вручную.
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <p className="text-sm font-medium">Импорт задач (MS Project XML/MSPDI, MPP, XLSX)</p>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <Input
                type="file"
                accept=".xml,.mpp,.xlsx"
                onChange={(e) => setMSProjectFile(e.target.files?.[0] ?? null)}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground md:min-w-fit">
                <span>Заменить предыдущий импорт MS Project</span>
                <Switch
                  checked={replaceExistingMSImport}
                  onCheckedChange={setReplaceExistingMSImport}
                />
              </label>
              <Button
                variant="outline"
                onClick={handleImportMSProject}
                disabled={!msProjectFile || importMSProjectTasks.isPending || !canImport}
              >
                {importMSProjectTasks.isPending ? 'Импорт...' : 'Импортировать задачи'}
              </Button>
            </div>
            {importFilePrecheck && (
              <div className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Быстрая проверка файла</p>
                <div className="mt-2 space-y-1.5">
                  <p>Файл: {msProjectFile?.name}</p>
                  {importFilePrecheck.messages.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </div>
              </div>
            )}
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-foreground">Подсказка по импорту</p>
                <Link
                  to="/help#import"
                  className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                >
                  Подробнее в Help
                </Link>
              </div>
              <div className="mt-2 space-y-1.5">
                <p>1. Для MS Project используйте `XML/MSPDI`, а не исходный `.mpp`, если нужен стабильный структурный импорт.</p>
                <p>2. Для XLSX лучше всего работают явные колонки вроде: `Наименование`, `Срок`, `Исполнитель`, `Заказчик`, `Вид задачи`.</p>
                <p>3. Исполнителя система старается распознать по `email` или по форме имени вроде `Фамилия И.О.`.</p>
                <p>4. Если исполнителя ещё нет в системе, имя может попасть во временные назначения для дальнейшей привязки.</p>
              </div>
            </div>
            <div className="rounded-lg border bg-card p-3 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-foreground">Мини-гайд по XLSX</p>
                <div className="flex items-center gap-3">
                  <a
                    href="/templates/plannerbro-import-template.csv"
                    download
                    className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                  >
                    Скачать CSV
                  </a>
                  <a
                    href="/templates/plannerbro-import-template.xlsx"
                    download
                    className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                  >
                    Скачать шаблон XLSX
                  </a>
                  <Link
                    to="/help#import"
                    className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                  >
                    Полный пример
                  </Link>
                </div>
              </div>
              <div className="mt-2 overflow-x-auto rounded border">
                <table className="min-w-full">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-2 py-1 font-medium">Наименование</th>
                      <th className="px-2 py-1 font-medium">Срок</th>
                      <th className="px-2 py-1 font-medium">Исполнитель</th>
                      <th className="px-2 py-1 font-medium">Заказчик</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="px-2 py-1">Подготовить паспорт предприятия</td>
                      <td className="px-2 py-1">2026-03-16</td>
                      <td className="px-2 py-1">Петров П.П.; ivanova@corp.ru</td>
                      <td className="px-2 py-1">ОМСИО</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-2 space-y-1">
                <p>Если исполнителей несколько, лучше разделять их `;`.</p>
                <p>Даты лучше подавать в явном формате `YYYY-MM-DD`.</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              При включенной замене удаляются только задачи, которые ранее были импортированы из MS Project в этом
              проекте.
            </p>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <Label htmlFor="ai-prompt-instruction">Промпт для ИИ (опционально)</Label>
            <textarea
              id="ai-prompt-instruction"
              value={aiPromptInstruction}
              onChange={(e) => setAIPromptInstruction(e.target.value)}
              rows={3}
              maxLength={4000}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Например: 'Строго парси колонку Исполнитель, дедлайн брать из колонки Срок, не пропускать строки без заказчика'."
            />
            <p className="text-xs text-muted-foreground">
              Эти указания применяются при нажатии «Запустить ИИ/Запустить сейчас» для файла.
            </p>
          </div>
          {!canImport && (
            <p className="text-xs text-muted-foreground">
              У вас нет права `import` для загрузки/обработки файлов.
            </p>
          )}

          {files.length === 0 ? (
            <div className="text-sm text-muted-foreground">Файлов пока нет.</div>
          ) : (
            <div className="space-y-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
                >
                  {(() => {
                    const aiJob = latestJobByFile[file.id]
                    const meta = getAIStatusMeta(aiJob?.status)
                    const filePrecheck = fileImportPrechecks[file.id]
                    const isXlsx = file.filename.toLowerCase().endsWith('.xlsx')
                    const canRun = canImport && aiJob?.status !== 'processing' && (!isXlsx || filePrecheck?.can_start_ai !== false)
                    const actionLabel =
                      isXlsx && filePrecheck?.can_start_ai === false
                        ? 'Исправьте XLSX'
                        : !aiJob
                        ? 'Запустить ИИ'
                        : aiJob.status === 'failed'
                          ? 'Повторить ИИ'
                          : aiJob.status === 'completed'
                            ? 'Запустить заново'
                            : aiJob.status === 'queued'
                              ? 'Запустить сейчас'
                              : 'Обновляется...'

                    return (
                      <>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{file.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)} ·{' '}
                      {new Date(file.created_at).toLocaleDateString()} ·{' '}
                      {formatUserDisplayName(file.uploaded_by) || 'Неизвестно'}
                    </p>
                    <p className="text-xs mt-1 text-muted-foreground">
                      AI: {meta.label}
                      {aiJob?.status === 'completed' ? ` · черновиков: ${aiJob.drafts_count}` : ''}
                      {aiJob?.status === 'failed' && aiJob.error_message ? ` · ${aiJob.error_message}` : ''}
                    </p>
                    {filePrecheck && (
                      <div className="mt-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                        <p className="font-medium text-foreground">
                          Проверка структуры {filePrecheck.file_type.toUpperCase()}
                        </p>
                        {filePrecheck.detected_headers.length > 0 && (
                          <p className="mt-1 text-muted-foreground">
                            Колонки: {filePrecheck.detected_headers.join(', ')}
                          </p>
                        )}
                        {filePrecheck.recognized_columns.length > 0 && (
                          <p className="mt-1 text-emerald-700">
                            Распознано: {filePrecheck.recognized_columns.join(', ')}
                          </p>
                        )}
                        {filePrecheck.missing_columns.length > 0 && (
                          <p className="mt-1 text-amber-700">
                            Не хватает для уверенного разбора: {filePrecheck.missing_columns.join(', ')}
                          </p>
                        )}
                        {filePrecheck.warnings.map((warning) => (
                          <p key={warning} className="mt-1 text-amber-700">
                            {warning}
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="mt-1 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full ${meta.bar} transition-all duration-300`}
                        style={{ width: `${meta.percent}%` }}
                      />
                    </div>
                    {aiJob?.status === 'queued' && (
                      <p className="text-[11px] mt-1 text-amber-700">
                        Файл в очереди. Нажмите «Запустить сейчас», если хотите обработать немедленно.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        startAIProcessing.mutate({
                          projectId: id!,
                          fileId: file.id,
                          promptInstruction: aiPromptInstruction,
                        })
                      }
                      disabled={!canRun || startAIProcessing.isPending}
                    >
                      {startAIProcessing.isPending ? 'Запуск...' : actionLabel}
                    </Button>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          deleteProjectFile.mutate({ projectId: id!, fileId: file.id })
                        }
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                      </>
                    )
                  })()}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div>
                <p className="text-sm font-semibold">AI черновики задач</p>
                <p className="text-xs text-muted-foreground">
                  После загрузки документа ИИ предлагает задачи. Подтвердите нужные.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleToggleAllDrafts}
                  disabled={aiDrafts.length === 0}
                >
                  {allDraftsSelected ? 'Снять всё' : `Выбрать всё (${aiDrafts.length})`}
                </Button>
                <Button
                  size="sm"
                  onClick={handleApproveSelectedDrafts}
                  disabled={selectedDraftIds.length === 0 || approveAIDraftsBulk.isPending}
                >
                  {approveAIDraftsBulk.isPending
                    ? 'Создание...'
                    : `Подтвердить выбранные (${selectedDraftIds.length})`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRejectSelectedDrafts}
                  disabled={selectedDraftIds.length === 0 || rejectAIDraftsBulk.isPending}
                >
                  {rejectAIDraftsBulk.isPending
                    ? 'Удаление...'
                    : `Удалить выбранные (${selectedDraftIds.length})`}
                </Button>
              </div>
            </div>
            {aiDrafts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока нет pending-черновиков.</p>
            ) : (
              <div className="space-y-2">
                {aiDrafts.map((draft) => (
                  <div key={draft.id} className="rounded-lg border px-3 py-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedDraftIds.includes(draft.id)}
                        onChange={() =>
                          setSelectedDraftIds((prev) =>
                            prev.includes(draft.id)
                              ? prev.filter((id) => id !== draft.id)
                              : [...prev, draft.id]
                          )
                        }
                        className="mt-1 h-4 w-4"
                      />
                      <div className="flex-1 min-w-0">
                        {(() => {
                          const assigneeMeta = getDraftAssigneeMeta(draft)
                          return (
                            <span className={`mb-2 inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${assigneeMeta.tone}`}>
                              {assigneeMeta.label}
                            </span>
                          )
                        })()}
                        <p className="text-sm font-medium truncate">{draft.title}</p>
                        {draft.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{draft.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Приоритет: {draft.priority} · Confidence: {draft.confidence}%
                          {draft.end_date ? ` · Дедлайн: ${new Date(draft.end_date).toLocaleDateString()}` : ''}
                          {draft.assignee_hint ? ` · Кому: ${draft.assignee_hint}` : ''}
                        </p>
                        {draft.source_quote && (
                          <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
                            Источник: {draft.source_quote}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApproveDraft(draft.id)}
                          disabled={approveAIDraft.isPending}
                        >
                          Подтвердить
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRejectDraft(draft.id)}
                          disabled={rejectAIDraft.isPending}
                        >
                          Отклонить
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
    </div>
  )
}
