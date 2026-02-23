import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Project, Task, GanttData, Notification, ProjectFile } from '@/types'

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
    },
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: object }) =>
      api.updateTask(taskId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['gantt'] })
    },
  })
}

export function useUpdateTaskStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      api.updateTaskStatus(taskId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
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
    },
  })
}
