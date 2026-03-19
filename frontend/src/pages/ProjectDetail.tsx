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
  useBulkUpdateTasks,
  useProjectFiles,
  useProjectDeadlineHistory,
} from '@/hooks/useProjects'
import { useMembers } from '@/hooks/useMembers'
import { useProjectTaskListState } from '@/hooks/useProjectTaskListState'
import { useUsers } from '@/hooks/useUsers'
import { api } from '@/api/client'
import { GanttChart } from '@/components/GanttChart/GanttChart'
import { TaskDrawer } from '@/components/TaskDrawer/TaskDrawer'
import { MembersPanel } from '@/components/MembersPanel/MembersPanel'
import { ProjectEditDialog, type ProjectEditFormState } from '@/components/ProjectEditDialog/ProjectEditDialog'
import { ProjectFilesSection } from '@/components/ProjectFilesSection/ProjectFilesSection'
import { ProjectTaskCreateDialog, type ProjectTaskFormState } from '@/components/ProjectTaskCreateDialog/ProjectTaskCreateDialog'
import { ProjectTaskListToolbar } from '@/components/ProjectTaskListToolbar/ProjectTaskListToolbar'
import { TaskTable } from '@/components/TaskTable/TaskTable'
import { DeadlineReasonModal } from '@/components/DeadlineReasonModal/DeadlineReasonModal'
import { Button } from '@/components/ui/button'
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
import { buildTaskHierarchy } from '@/lib/taskOrdering'
import { formatUserDisplayName } from '@/lib/userName'
import type { Task, GanttTask } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { ArrowLeft, BarChart2, List, Users, Paperclip, Download, Trash2, ChevronDown, ChevronUp } from 'lucide-react'

const DEFAULT_DOD_CHECKLIST = [
  { id: 'scope_approved', label: 'Результаты проекта согласованы', done: false },
  { id: 'docs_prepared', label: 'Документация и инструкции подготовлены', done: false },
  { id: 'handover_done', label: 'Передача в сопровождение завершена', done: false },
  { id: 'retrospective_done', label: 'Ретроспектива проведена', done: false },
]

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
  const createTask = useCreateTask()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()
  const updateTaskStatus = useUpdateTaskStatus()
  const bulkUpdateTasks = useBulkUpdateTasks()
  const currentUser = useAuthStore((s) => s.user)

  const [view, setView] = useState<'gantt' | 'list' | 'members' | 'files'>('list')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [taskForm, setTaskForm] = useState<ProjectTaskFormState>({
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
  const [showProjectDeadlineModal, setShowProjectDeadlineModal] = useState(false)
  const [pendingProjectFormData, setPendingProjectFormData] = useState<Record<string, unknown> | null>(null)
  const [showProjectDeadlineHistory, setShowProjectDeadlineHistory] = useState(false)

  const { data: projectDeadlineHistory = [] } = useProjectDeadlineHistory(id)
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

  const {
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
  } = useProjectTaskListState({
    projectId: id!,
    tasks,
    canManage,
    canBulkEdit,
    canDelete,
    bulkUpdateTasks,
    updateTaskStatus,
    taskStatusOrder: TASK_STATUS_ORDER,
    taskPriorityOrder: TASK_PRIORITY_ORDER,
  })

  const handleDownload = async (file: { id: string; filename: string; content_type?: string | null }) => {
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

        <ProjectEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          canRenameProject={canRenameProject}
          canManage={canManage}
          canTransferOwnership={canTransferOwnership}
          editForm={editForm}
          setEditForm={setEditForm}
          onSubmit={handleUpdateProject}
          users={users}
          project={project}
          files={files}
          projectProgress={projectProgress}
          progressStats={progressStats}
          isPending={updateProject.isPending}
        />

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

        <ProjectTaskCreateDialog
          open={taskDialogOpen}
          onOpenChange={setTaskDialogOpen}
          onSubmit={handleCreateTask}
          taskForm={taskForm}
          setTaskForm={setTaskForm}
          projectAssigneeOptions={projectAssigneeOptions}
          taskHierarchyOptions={taskHierarchyOptions}
          isPending={createTask.isPending}
        />
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
          <ProjectTaskListToolbar
            taskSearch={taskSearch}
            onTaskSearchChange={setTaskSearch}
            taskStatusFilter={taskStatusFilter}
            onTaskStatusFilterChange={setTaskStatusFilter}
            taskAssigneeFilter={taskAssigneeFilter}
            onTaskAssigneeFilterChange={setTaskAssigneeFilter}
            members={members}
            selectedVisibleCount={selectedVisibleCount}
            filteredTasksCount={filteredTasks.length}
            selectedTaskIdsCount={selectedTaskIds.length}
            onToggleSelectAllVisible={handleToggleSelectAllVisible}
            taskSortBy={taskSortBy}
            onTaskSortByChange={setTaskSortBy}
            taskSortDir={taskSortDir}
            onTaskSortDirChange={setTaskSortDir}
            taskRowSize={taskRowSize}
            onTaskRowSizeChange={setTaskRowSize}
            canManage={canManage}
            canBulkEdit={canBulkEdit}
            canDelete={canDelete}
            bulkBusy={bulkBusy}
            bulkAssignee={bulkAssignee}
            onBulkAssigneeChange={setBulkAssignee}
            bulkPriority={bulkPriority}
            onBulkPriorityChange={setBulkPriority}
            onBulkStatusUpdate={handleBulkStatusUpdate}
            onBulkDelete={handleBulkDelete}
            onBulkAssign={handleBulkAssign}
            onBulkPriority={handleBulkPriority}
          />

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
        <ProjectFilesSection projectId={id!} canImport={canImport} canManage={canManage} />
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
