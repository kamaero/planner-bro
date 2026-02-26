import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query'
import { api } from '@/api/client'
import type {
  Project,
  Task,
  GanttData,
  Notification,
  ProjectFile,
  TaskComment,
  TaskEvent,
  AIIngestionJob,
  AITaskDraft,
  MSProjectImportResult,
  TaskBulkUpdateResult,
  DeadlineChange,
  DeadlineStats,
  TaskDependency,
} from '@/types'

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: api.listProjects,
  })
}

export function useProject(id: string) {
  return useQuery<Project>({
    queryKey: ['projects', id],
    queryFn: () => api.getProject(id),
    enabled: !!id,
  })
}

export function useGantt(projectId: string) {
  return useQuery<GanttData>({
    queryKey: ['gantt', projectId],
    queryFn: () => api.getGantt(projectId),
    enabled: !!projectId,
  })
}

export function useCriticalPath(projectId: string) {
  return useQuery<{
    project_id: string
    length: number
    task_ids: string[]
    tasks: Array<{ id: string; title: string; status: string; end_date?: string | null }>
  }>({
    queryKey: ['critical-path', projectId],
    queryFn: () => api.getCriticalPath(projectId),
    enabled: !!projectId,
  })
}

export function useTasks(projectId: string) {
  return useQuery<Task[]>({
    queryKey: ['tasks', projectId],
    queryFn: () => api.listTasks(projectId),
    enabled: !!projectId,
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: object) => api.createProject(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: object }) =>
      api.updateProject(projectId, data),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['projects', projectId] })
    },
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: object }) =>
      api.createTask(projectId, data),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['tasks', projectId] })
      qc.invalidateQueries({ queryKey: ['gantt', projectId] })
      qc.invalidateQueries({ queryKey: ['critical-path', projectId] })
      qc.invalidateQueries({ queryKey: ['escalations'] })
    },
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: object }) =>
      api.updateTask(taskId, data),
    onSuccess: (updatedTask: Task) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['gantt'] })
      qc.invalidateQueries({ queryKey: ['critical-path', updatedTask.project_id] })
      qc.invalidateQueries({ queryKey: ['escalations'] })
    },
  })
}

export function useUpdateTaskStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      taskId,
      status,
      progress_percent,
      next_step,
    }: {
      taskId: string
      status: string
      progress_percent?: number
      next_step?: string | null
    }) => api.updateTaskStatus(taskId, { status, progress_percent, next_step }),
    onSuccess: (updatedTask: Task) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['gantt'] })
      qc.invalidateQueries({ queryKey: ['critical-path', updatedTask.project_id] })
      qc.invalidateQueries({ queryKey: ['escalations'] })
    },
  })
}

export function useTaskCheckIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      taskId,
      summary,
      blockers,
      next_check_in_due_at,
      need_manager_help,
    }: {
      taskId: string
      summary: string
      blockers?: string | null
      next_check_in_due_at?: string | null
      need_manager_help?: boolean
    }) =>
      api.checkInTask(taskId, {
        summary,
        blockers,
        next_check_in_due_at,
        need_manager_help,
      }),
    onSuccess: (updatedTask: Task, { taskId }) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['gantt'] })
      qc.invalidateQueries({ queryKey: ['critical-path', updatedTask.project_id] })
      qc.invalidateQueries({ queryKey: ['task-comments', taskId] })
      qc.invalidateQueries({ queryKey: ['task-events', taskId] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useTaskDependencies(taskId?: string) {
  return useQuery<TaskDependency[]>({
    queryKey: ['task-dependencies', taskId],
    queryFn: () => api.listTaskDependencies(taskId!),
    enabled: !!taskId,
  })
}

export function useAddTaskDependency() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, predecessorTaskId }: { taskId: string; predecessorTaskId: string }) =>
      api.addTaskDependency(taskId, predecessorTaskId),
    onSuccess: (_, { taskId }) => {
      qc.invalidateQueries({ queryKey: ['task-dependencies', taskId] })
      qc.invalidateQueries({ queryKey: ['task-events', taskId] })
      qc.invalidateQueries({ queryKey: ['gantt'] })
    },
  })
}

export function useRemoveTaskDependency() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, predecessorTaskId }: { taskId: string; predecessorTaskId: string }) =>
      api.removeTaskDependency(taskId, predecessorTaskId),
    onSuccess: (_, { taskId }) => {
      qc.invalidateQueries({ queryKey: ['task-dependencies', taskId] })
      qc.invalidateQueries({ queryKey: ['task-events', taskId] })
      qc.invalidateQueries({ queryKey: ['gantt'] })
    },
  })
}

export function useProjectFiles(projectId: string) {
  return useQuery<ProjectFile[]>({
    queryKey: ['project-files', projectId],
    queryFn: () => api.listProjectFiles(projectId),
    enabled: !!projectId,
  })
}

export function useUploadProjectFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, file }: { projectId: string; file: File }) =>
      api.uploadProjectFile(projectId, file),
    onSuccess: (_, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['project-files', projectId] }),
  })
}

export function useDeleteProjectFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, fileId }: { projectId: string; fileId: string }) =>
      api.deleteProjectFile(projectId, fileId),
    onSuccess: (_, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['project-files', projectId] }),
  })
}

export function useImportMSProjectTasks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, file }: { projectId: string; file: File }) =>
      api.importMSProjectTasks(projectId, file) as Promise<MSProjectImportResult>,
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['tasks', projectId] })
      qc.invalidateQueries({ queryKey: ['gantt', projectId] })
      qc.invalidateQueries({ queryKey: ['critical-path', projectId] })
    },
  })
}

export function useAIJobs(projectId: string) {
  return useQuery<AIIngestionJob[]>({
    queryKey: ['ai-jobs', projectId],
    queryFn: () => api.listAIJobs(projectId),
    enabled: !!projectId,
    refetchInterval: 5000,
  })
}

export function useStartAIProcessing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, fileId }: { projectId: string; fileId: string }) =>
      api.startAIProcessingForFile(projectId, fileId),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['ai-jobs', projectId] })
    },
  })
}

export function useAIDrafts(projectId: string, statusFilter = 'pending') {
  return useQuery<AITaskDraft[]>({
    queryKey: ['ai-drafts', projectId, statusFilter],
    queryFn: () => api.listAIDrafts(projectId, { status_filter: statusFilter }),
    enabled: !!projectId,
    refetchInterval: 5000,
  })
}

export function useApproveAIDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, draftId }: { projectId: string; draftId: string }) =>
      api.approveAIDraft(projectId, draftId),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['ai-drafts', projectId] })
      qc.invalidateQueries({ queryKey: ['tasks', projectId] })
      qc.invalidateQueries({ queryKey: ['gantt', projectId] })
      qc.invalidateQueries({ queryKey: ['critical-path', projectId] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useApproveAIDraftsBulk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, draftIds }: { projectId: string; draftIds: string[] }) =>
      api.approveAIDraftsBulk(projectId, draftIds),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['ai-drafts', projectId] })
      qc.invalidateQueries({ queryKey: ['tasks', projectId] })
      qc.invalidateQueries({ queryKey: ['gantt', projectId] })
      qc.invalidateQueries({ queryKey: ['critical-path', projectId] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useRejectAIDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, draftId }: { projectId: string; draftId: string }) =>
      api.rejectAIDraft(projectId, draftId),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['ai-drafts', projectId] })
    },
  })
}

export function useAllTasks() {
  const { data: projects = [] } = useProjects()
  const results = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['tasks', p.id],
      queryFn: () => api.listTasks(p.id),
      enabled: !!p.id,
    })),
  })
  const tasks: Task[] = results.flatMap((r) => (r.data as Task[] | undefined) ?? [])
  const isLoading = results.some((r) => r.isLoading)
  return { tasks, projects, isLoading }
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) => api.deleteTask(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['gantt'] })
      qc.invalidateQueries({ queryKey: ['critical-path'] })
      qc.invalidateQueries({ queryKey: ['escalations'] })
    },
  })
}

export function useBulkUpdateTasks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      data,
    }: {
      projectId: string
      data: {
        task_ids: string[]
        status?: string
        priority?: string
        control_ski?: boolean
        assigned_to_id?: string | null
        delete?: boolean
      }
    }) => api.bulkUpdateTasks(projectId, data) as Promise<TaskBulkUpdateResult>,
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['tasks', projectId] })
      qc.invalidateQueries({ queryKey: ['gantt', projectId] })
      qc.invalidateQueries({ queryKey: ['critical-path', projectId] })
      qc.invalidateQueries({ queryKey: ['escalations'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useEscalations() {
  return useQuery<Task[]>({
    queryKey: ['escalations'],
    queryFn: api.listEscalations,
  })
}

export function useTaskComments(taskId?: string) {
  return useQuery<TaskComment[]>({
    queryKey: ['task-comments', taskId],
    queryFn: () => api.listTaskComments(taskId!),
    enabled: !!taskId,
  })
}

export function useAddTaskComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: string }) => api.addTaskComment(taskId, body),
    onSuccess: (_, { taskId }) => {
      qc.invalidateQueries({ queryKey: ['task-comments', taskId] })
      qc.invalidateQueries({ queryKey: ['task-events', taskId] })
    },
  })
}

export function useTaskEvents(taskId?: string) {
  return useQuery<TaskEvent[]>({
    queryKey: ['task-events', taskId],
    queryFn: () => api.listTaskEvents(taskId!),
    enabled: !!taskId,
  })
}

export function useTaskDeadlineHistory(taskId?: string) {
  return useQuery<DeadlineChange[]>({
    queryKey: ['deadline-history-task', taskId],
    queryFn: () => api.listTaskDeadlineHistory(taskId!),
    enabled: !!taskId,
  })
}

export function useProjectDeadlineHistory(projectId?: string) {
  return useQuery<DeadlineChange[]>({
    queryKey: ['deadline-history-project', projectId],
    queryFn: () => api.listProjectDeadlineHistory(projectId!),
    enabled: !!projectId,
  })
}

export function useDeadlineStats() {
  return useQuery<DeadlineStats>({
    queryKey: ['deadline-stats'],
    queryFn: () => api.getDeadlineStats(),
  })
}
