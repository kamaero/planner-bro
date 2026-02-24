import { useEffect, useMemo, useState } from 'react'
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
  useDeleteTask,
  useProjectFiles,
  useUploadProjectFile,
  useDeleteProjectFile,
  useImportMSProjectTasks,
  useAIJobs,
  useAIDrafts,
  useApproveAIDraft,
  useApproveAIDraftsBulk,
  useRejectAIDraft,
} from '@/hooks/useProjects'
import { useMembers } from '@/hooks/useMembers'
import { api } from '@/api/client'
import { GanttChart } from '@/components/GanttChart/GanttChart'
import { TaskDrawer } from '@/components/TaskDrawer/TaskDrawer'
import { MembersPanel } from '@/components/MembersPanel/MembersPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { Task, GanttTask, ProjectFile, MSProjectImportResult } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { ArrowLeft, Plus, BarChart2, List, Users, Pencil, Paperclip, Download, Trash2 } from 'lucide-react'

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'К выполнению',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Выполнено',
}

const PROJECT_STATUS_OPTIONS = [
  { value: 'planning', label: 'Планирование' },
  { value: 'active', label: 'Активный' },
  { value: 'on_hold', label: 'Пауза' },
  { value: 'completed', label: 'Завершён' },
]

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
  const { data: files = [] } = useProjectFiles(id!)
  const { data: aiJobs = [] } = useAIJobs(id!)
  const { data: aiDrafts = [] } = useAIDrafts(id!, 'pending')
  const createTask = useCreateTask()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const updateTaskStatus = useUpdateTaskStatus()
  const deleteTask = useDeleteTask()
  const uploadProjectFile = useUploadProjectFile()
  const deleteProjectFile = useDeleteProjectFile()
  const importMSProjectTasks = useImportMSProjectTasks()
  const approveAIDraft = useApproveAIDraft()
  const approveAIDraftsBulk = useApproveAIDraftsBulk()
  const rejectAIDraft = useRejectAIDraft()
  const currentUser = useAuthStore((s) => s.user)

  const [view, setView] = useState<'gantt' | 'list' | 'members' | 'files'>('gantt')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [fileToUpload, setFileToUpload] = useState<File | null>(null)
  const [msProjectFile, setMsProjectFile] = useState<File | null>(null)
  const [msProjectImportResult, setMsProjectImportResult] = useState<MSProjectImportResult | null>(null)
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
    parent_task_id: '',
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
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([])

  const memberRole = members.find((m) => m.user.id === currentUser?.id)?.role
  const canManage = currentUser?.role === 'admin' || memberRole === 'owner' || memberRole === 'manager'
  const canTransferOwnership = currentUser?.role === 'admin' || memberRole === 'owner'

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const searchOk =
        !taskSearch.trim() ||
        task.title.toLowerCase().includes(taskSearch.toLowerCase()) ||
        (task.description ?? '').toLowerCase().includes(taskSearch.toLowerCase())

      const statusOk = taskStatusFilter === 'all' || task.status === taskStatusFilter

      const assigneeOk =
        taskAssigneeFilter === 'all' ||
        (taskAssigneeFilter === 'unassigned'
          ? !task.assigned_to_id
          : task.assigned_to_id === taskAssigneeFilter)

      return searchOk && statusOk && assigneeOk
    })
  }, [tasks, taskSearch, taskStatusFilter, taskAssigneeFilter])

  const selectedVisibleCount = filteredTasks.filter((t) => selectedTaskIds.includes(t.id)).length

  useEffect(() => {
    if (project && editOpen) {
      setEditForm({
        name: project.name,
        description: project.description ?? '',
        status: project.status,
        priority: project.priority,
        control_ski: project.control_ski,
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
    if (!canManage || selectedTaskIds.length === 0) return
    setBulkBusy(true)
    try {
      await Promise.all(
        selectedTaskIds.map((taskId) =>
          updateTaskStatus.mutateAsync({
            taskId,
            status,
            progress_percent: status === 'done' ? 100 : undefined,
          })
        )
      )
      setSelectedTaskIds([])
    } finally {
      setBulkBusy(false)
    }
  }

  const handleBulkDelete = async () => {
    if (!canManage || selectedTaskIds.length === 0) return
    if (!window.confirm(`Удалить выбранные задачи (${selectedTaskIds.length})?`)) return
    setBulkBusy(true)
    try {
      await Promise.all(selectedTaskIds.map((taskId) => deleteTask.mutateAsync(taskId)))
      setSelectedTaskIds([])
    } finally {
      setBulkBusy(false)
    }
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
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
        parent_task_id: taskForm.parent_task_id || undefined,
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
      parent_task_id: '',
      is_escalation: false,
      escalation_for: '',
      escalation_sla_hours: '24',
      repeat_every_days: '',
    })
  }

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    await updateProject.mutateAsync({
      projectId: id!,
      data: {
        name: editForm.name,
        description: editForm.description,
        status: editForm.status,
        priority: editForm.control_ski ? 'critical' : editForm.priority,
        control_ski: editForm.control_ski,
        launch_basis_text: editForm.launch_basis_text.trim() || null,
        launch_basis_file_id: editForm.launch_basis_file_id || null,
        start_date: editForm.start_date || null,
        end_date: editForm.end_date || null,
        owner_id: canTransferOwnership ? editForm.owner_id || null : project?.owner_id ?? editForm.owner_id,
        completion_checklist: editForm.completion_checklist,
      },
    })
    setEditOpen(false)
  }

  const handleUploadFile = async () => {
    if (!fileToUpload) return
    await uploadProjectFile.mutateAsync({ projectId: id!, file: fileToUpload })
    setFileToUpload(null)
  }

  const handleDeleteProject = async () => {
    if (!id || !canManage) return
    if (!window.confirm('Удалить проект? Это действие нельзя отменить.')) return
    await deleteProject.mutateAsync(id)
    navigate('/')
  }

  const handleImportMSProject = async () => {
    if (!msProjectFile) return
    const result = await importMSProjectTasks.mutateAsync({ projectId: id!, file: msProjectFile })
    setMsProjectImportResult(result)
    setMsProjectFile(null)
  }

  const handleQuickStatusChange = async (task: Task, status: string) => {
    const suggestedProgress = status === 'done' ? 100 : task.progress_percent ?? 0
    const progressInput = window.prompt('Прогресс задачи (0-100)', String(suggestedProgress))
    if (progressInput === null) return
    const progress = Number.parseInt(progressInput, 10)
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      window.alert('Прогресс должен быть числом от 0 до 100.')
      return
    }
    const nextStepInput = window.prompt(
      'Следующий шаг (можно оставить пустым)',
      task.next_step ?? ''
    )
    if (nextStepInput === null) return
    await updateTaskStatus.mutateAsync({
      taskId: task.id,
      status,
      progress_percent: progress,
      next_step: nextStepInput.trim() || null,
    })
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

  if (!project) {
    return <div className="p-6 text-muted-foreground">Loading...</div>
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2 flex-1">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color }} />
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <Badge variant="secondary">{project.status}</Badge>
          <Badge variant="outline" className={PRIORITY_COLORS[project.control_ski ? 'critical' : project.priority]}>
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
            <Button variant="outline" size="sm" disabled={!canManage}>
              <Pencil className="w-4 h-4 mr-1" />
              Редактировать
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Редактировать проект</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpdateProject} className="space-y-4">
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
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Статус</Label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full border rounded px-2 py-2 bg-background text-sm"
                  >
                    {PROJECT_STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label>Приоритет</Label>
                  <div className="flex items-center gap-3">
                    <select
                      value={editForm.control_ski ? 'critical' : editForm.priority}
                      onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}
                      className="w-full border rounded px-2 py-2 bg-background text-sm"
                      disabled={editForm.control_ski}
                    >
                      <option value="low">Низкий</option>
                      <option value="medium">Средний</option>
                      <option value="high">Высокий</option>
                      <option value="critical">Критический</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={editForm.control_ski}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            control_ski: e.target.checked,
                            priority: e.target.checked ? 'critical' : f.priority,
                          }))
                        }
                        className="h-4 w-4"
                      />
                      Контроль СКИ
                    </label>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Ответственный</Label>
                  <select
                    value={editForm.owner_id}
                    onChange={(e) => setEditForm((f) => ({ ...f, owner_id: e.target.value }))}
                    className="w-full border rounded px-2 py-2 bg-background text-sm"
                    disabled={!canTransferOwnership}
                  >
                    {members.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        {m.user.name}
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

              <div className="space-y-1">
                <Label>Основание запуска</Label>
                <Input
                  value={editForm.launch_basis_text}
                  onChange={(e) => setEditForm((f) => ({ ...f, launch_basis_text: e.target.value }))}
                  placeholder="Напр.: Приказ #111222333 24.02.2026"
                />
              </div>

              <div className="space-y-1">
                <Label>Файл основания запуска</Label>
                <select
                  value={editForm.launch_basis_file_id}
                  onChange={(e) => setEditForm((f) => ({ ...f, launch_basis_file_id: e.target.value }))}
                  className="w-full border rounded px-2 py-2 bg-background text-sm"
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
                  />
                </div>
                <div className="space-y-1">
                  <Label>Дата окончания</Label>
                  <Input
                    type="date"
                    value={editForm.end_date}
                    onChange={(e) => setEditForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-2 rounded-lg border p-3">
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
              <Button type="submit" className="w-full" disabled={updateProject.isPending}>
                {updateProject.isPending ? 'Сохранение...' : 'Сохранить изменения'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        {canManage && (
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
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Создать задачу</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div className="space-y-1">
                <Label>Название</Label>
                <Input
                  value={taskForm.title}
                  onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))}
                  required
                  placeholder="Название задачи"
                />
              </div>
              <div className="space-y-1">
                <Label>Описание</Label>
                <Input
                  value={taskForm.description}
                  onChange={(e) => setTaskForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Необязательно"
                />
              </div>
              <div className="space-y-1">
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
                    <input
                      type="checkbox"
                      checked={taskForm.control_ski}
                      onChange={(e) =>
                        setTaskForm((f) => ({
                          ...f,
                          control_ski: e.target.checked,
                          priority: e.target.checked ? 'critical' : f.priority,
                        }))
                      }
                      className="h-4 w-4"
                    />
                    Контроль СКИ
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
              <div className="space-y-1">
                <Label>Исполнитель</Label>
                <select
                  value={taskForm.assigned_to_id}
                  onChange={(e) => setTaskForm((f) => ({ ...f, assigned_to_id: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                >
                  <option value="">Не назначен</option>
                  {members.map((m) => (
                    <option key={m.user.id} value={m.user.id}>
                      {m.user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Зависит от</Label>
                <select
                  value={taskForm.parent_task_id}
                  onChange={(e) => setTaskForm((f) => ({ ...f, parent_task_id: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                >
                  <option value="">Без зависимости</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
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
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={taskForm.is_escalation}
                  onChange={(e) => setTaskForm((f) => ({ ...f, is_escalation: e.target.checked }))}
                />
                Эскалация на руководителя
              </label>
              {taskForm.is_escalation && (
                <div className="space-y-1">
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
              <Button type="submit" className="w-full" disabled={createTask.isPending}>
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
                <option value="todo">К выполнению</option>
                <option value="in_progress">В работе</option>
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
                    {m.user.name}
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
              {canManage && (
                <>
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
                    onClick={() => handleBulkStatusUpdate('done')}
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                  >
                    Завершить
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleBulkDelete}
                    disabled={selectedTaskIds.length === 0 || bulkBusy}
                  >
                    Удалить выбранные
                  </Button>
                </>
              )}
            </div>
          </div>

          {filteredTasks.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              Задачи по выбранным фильтрам не найдены.
            </div>
          )}
          {filteredTasks.map((task) => (
            <div
              key={task.id}
              className="w-full rounded-lg border bg-card p-4 hover:shadow-sm transition-shadow"
            >
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
                    <span className="text-xs text-muted-foreground">{task.assignee.name}</span>
                  )}
                  <select
                    value={task.status}
                    onChange={(e) => handleQuickStatusChange(task, e.target.value)}
                    className="text-xs border rounded px-2 py-1 bg-background"
                  >
                    <option value="todo">{STATUS_LABELS.todo}</option>
                    <option value="in_progress">{STATUS_LABELS.in_progress}</option>
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
            </div>
          ))}
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
                disabled={!fileToUpload || uploadProjectFile.isPending}
              >
                {uploadProjectFile.isPending ? 'Загрузка...' : 'Загрузить файл'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Добавляйте материалы проекта: pdf, docx, ppt и другие файлы
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold">Импорт задач из MS Project XML</p>
                <p className="text-xs text-muted-foreground">
                  Поддерживается XML-экспорт MS Project (MSPDI). Структура задач и даты сохраняются.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  onChange={(e) => setMsProjectFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  variant="outline"
                  onClick={handleImportMSProject}
                  disabled={!msProjectFile || importMSProjectTasks.isPending}
                >
                  {importMSProjectTasks.isPending ? 'Импорт...' : 'Импортировать задачи'}
                </Button>
              </div>
            </div>
            {msProjectImportResult && (
              <p className="text-xs text-muted-foreground">
                Импорт завершен: создано {msProjectImportResult.created}, связей родитель-дочерняя{' '}
                {msProjectImportResult.linked_to_parent}, пропущено {msProjectImportResult.skipped}, всего в файле{' '}
                {msProjectImportResult.total_in_file}.
              </p>
            )}
            {importMSProjectTasks.isError && (
              <p className="text-xs text-red-600">
                Ошибка импорта: {(importMSProjectTasks.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'не удалось обработать файл'}
              </p>
            )}
          </div>

          {files.length === 0 ? (
            <div className="text-sm text-muted-foreground">Файлов пока нет.</div>
          ) : (
            <div className="space-y-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{file.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)} ·{' '}
                      {new Date(file.created_at).toLocaleDateString()} ·{' '}
                      {file.uploaded_by?.name ?? 'Неизвестно'}
                    </p>
                    {latestJobByFile[file.id] && (
                      <p className="text-xs mt-1 text-muted-foreground">
                        AI: {latestJobByFile[file.id].status}
                        {latestJobByFile[file.id].status === 'completed'
                          ? ` · черновиков: ${latestJobByFile[file.id].drafts_count}`
                          : ''}
                        {latestJobByFile[file.id].status === 'failed' && latestJobByFile[file.id].error_message
                          ? ` · ${latestJobByFile[file.id].error_message}`
                          : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleDownload(file)}>
                      <Download className="w-4 h-4 mr-1" />
                      Скачать
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
              <Button
                size="sm"
                onClick={handleApproveSelectedDrafts}
                disabled={selectedDraftIds.length === 0 || approveAIDraftsBulk.isPending}
              >
                {approveAIDraftsBulk.isPending
                  ? 'Создание...'
                  : `Подтвердить выбранные (${selectedDraftIds.length})`}
              </Button>
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
    </div>
  )
}
