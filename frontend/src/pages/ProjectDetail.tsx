import { useEffect, useMemo, useState } from 'react'
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
  useProjectFiles,
  useProjectDeadlineHistory,
} from '@/hooks/useProjects'
import { useMembers } from '@/hooks/useMembers'
import { useProjectDetailActions } from '@/hooks/useProjectDetailActions'
import { useProjectDetailDerived } from '@/hooks/useProjectDetailDerived'
import { useProjectDetailTaskSelection } from '@/hooks/useProjectDetailTaskSelection'
import { useProjectTaskListState } from '@/hooks/useProjectTaskListState'
import { useUsers } from '@/hooks/useUsers'
import { api } from '@/api/client'
import { TaskDrawer } from '@/components/TaskDrawer/TaskDrawer'
import { ProjectEditDialog, type ProjectEditFormState } from '@/components/ProjectEditDialog/ProjectEditDialog'
import { ProjectTaskCreateDialog, type ProjectTaskFormState } from '@/components/ProjectTaskCreateDialog/ProjectTaskCreateDialog'
import { ProjectDetailContent, type ProjectDetailView } from '@/components/ProjectDetail/ProjectDetailContent'
import { ProjectDetailHeader } from '@/components/ProjectDetail/ProjectDetailHeader'
import { ProjectDetailSummaryCard } from '@/components/ProjectDetail/ProjectDetailSummaryCard'
import { DeadlineReasonModal } from '@/components/DeadlineReasonModal/DeadlineReasonModal'
import { Button } from '@/components/ui/button'
import {
  TASK_PRIORITY_ORDER,
  TASK_STATUS_ORDER,
} from '@/lib/domainMeta'
import { useAuthStore } from '@/store/authStore'
import { Trash2 } from 'lucide-react'

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
  const { data: ganttData, isLoading: ganttLoading } = useGantt(id!)
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

  const [view, setView] = useState<ProjectDetailView>('list')
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
  const [showProjectDeadlineHistory, setShowProjectDeadlineHistory] = useState(false)

  const { data: projectDeadlineHistory = [] } = useProjectDeadlineHistory(id)
  const shiftsMap = useMemo(() => ({} as Record<string, number>), [])
  const {
    canManage,
    canRenameProject,
    canTransferOwnership,
    canDelete,
    canImport,
    canBulkEdit,
    projectAssigneeOptions,
    projectProgress,
    progressStats,
    taskHierarchyOptions,
    launchBasisFile,
  } = useProjectDetailDerived({
    project,
    tasks,
    members,
    users,
    files,
    currentUser,
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

  const {
    selectedTask,
    drawerOpen,
    setDrawerOpen,
    handleGanttTaskClick,
    handleTaskClick,
  } = useProjectDetailTaskSelection({
    locationSearch: location.search,
    tasks,
  })

  const {
    showProjectDeadlineModal,
    pendingProjectFormData,
    handleCreateTask,
    handleUpdateProject,
    handleProjectDeadlineConfirm,
    handleProjectDeadlineCancel,
    handleDeleteProject,
  } = useProjectDetailActions({
    projectId: id!,
    canManage,
    canDelete,
    canTransferOwnership,
    currentProjectOwnerId: project?.owner_id,
    editForm,
    setEditOpen,
    setTaskDialogOpen,
    setTaskForm,
    navigateToRoot: () => navigate('/'),
    createTask: createTask.mutateAsync,
    updateProject: updateProject.mutateAsync,
    deleteProject: deleteProject.mutateAsync,
  })

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
      <ProjectDetailHeader
        project={project}
        view={view}
        onViewChange={setView}
        hasLaunchBasis={Boolean(project.launch_basis_text || launchBasisFile)}
        actions={
          <>
            <ProjectEditDialog
              open={editOpen}
              onOpenChange={setEditOpen}
              canRenameProject={canRenameProject}
              canManage={canManage}
              canTransferOwnership={canTransferOwnership}
              editForm={editForm}
              setEditForm={setEditForm}
              onSubmit={(event) => handleUpdateProject(event, project.end_date)}
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
              onSubmit={(event) => handleCreateTask(event, taskForm)}
              taskForm={taskForm}
              setTaskForm={setTaskForm}
              projectAssigneeOptions={projectAssigneeOptions}
              taskHierarchyOptions={taskHierarchyOptions}
              isPending={createTask.isPending}
            />
          </>
        }
      />

      <ProjectDetailSummaryCard
        project={project}
        projectProgress={projectProgress}
        progressStats={progressStats}
        projectDeadlineHistory={projectDeadlineHistory}
        showProjectDeadlineHistory={showProjectDeadlineHistory}
        onToggleProjectDeadlineHistory={() => setShowProjectDeadlineHistory(!showProjectDeadlineHistory)}
        launchBasisFile={launchBasisFile}
        onDownloadLaunchBasis={handleDownload}
      />

      {/* Description */}
      {project.description && (
        <p className="text-muted-foreground text-sm mb-6">{project.description}</p>
      )}

      <ProjectDetailContent
        projectId={id!}
        view={view}
        canImport={canImport}
        canManage={canManage}
        ganttSectionProps={{
          tasks: ganttData?.tasks ?? [],
          criticalPath,
          onTaskClick: handleGanttTaskClick,
          isLoading: ganttLoading,
        }}
        taskListSectionProps={{
          toolbarProps: {
            taskSearch,
            onTaskSearchChange: setTaskSearch,
            taskStatusFilter,
            onTaskStatusFilterChange: setTaskStatusFilter,
            taskAssigneeFilter,
            onTaskAssigneeFilterChange: setTaskAssigneeFilter,
            members,
            selectedVisibleCount,
            filteredTasksCount: filteredTasks.length,
            selectedTaskIdsCount: selectedTaskIds.length,
            onToggleSelectAllVisible: handleToggleSelectAllVisible,
            taskSortBy,
            onTaskSortByChange: setTaskSortBy,
            taskSortDir,
            onTaskSortDirChange: setTaskSortDir,
            taskRowSize,
            onTaskRowSizeChange: setTaskRowSize,
            canManage,
            canBulkEdit,
            canDelete,
            bulkBusy,
            bulkAssignee,
            onBulkAssigneeChange: setBulkAssignee,
            bulkPriority,
            onBulkPriorityChange: setBulkPriority,
            onBulkStatusUpdate: handleBulkStatusUpdate,
            onBulkDelete: handleBulkDelete,
            onBulkAssign: handleBulkAssign,
            onBulkPriority: handleBulkPriority,
          },
          tableProps: {
            tasks: filteredTasks,
            allTasks: tasks,
            onTaskClick: handleTaskClick,
            onStatusChange: (taskId, status) => {
              const task = tasks.find((t) => t.id === taskId)
              if (task) handleQuickStatusChange(task, status)
            },
            shiftsMap,
            rowSize: taskRowSize,
          },
        }}
      />

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
