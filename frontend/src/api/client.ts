import axios from 'axios'
import { useAuthStore } from '@/store/authStore'

export const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Attach access token to every request
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Auto-refresh on 401
let refreshing = false
let refreshQueue: Array<(token: string) => void> = []

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true

      if (refreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token) => {
            original.headers.Authorization = `Bearer ${token}`
            resolve(apiClient(original))
          })
        })
      }

      refreshing = true
      try {
        const { refreshToken, setTokens, logout } = useAuthStore.getState()
        if (!refreshToken) {
          logout()
          return Promise.reject(error)
        }

        const res = await axios.post('/api/v1/auth/refresh', {
          refresh_token: refreshToken,
        })
        const { access_token, refresh_token } = res.data
        setTokens(access_token, refresh_token)

        refreshQueue.forEach((cb) => cb(access_token))
        refreshQueue = []

        original.headers.Authorization = `Bearer ${access_token}`
        return apiClient(original)
      } catch {
        useAuthStore.getState().logout()
        return Promise.reject(error)
      } finally {
        refreshing = false
      }
    }

    return Promise.reject(error)
  }
)

// API functions
export const api = {
  // Auth
  login: (email: string, password: string) =>
    apiClient.post('/auth/login', { email, password }).then((r) => r.data),
  refresh: (refreshToken: string) =>
    axios.post('/api/v1/auth/refresh', { refresh_token: refreshToken }).then((r) => r.data),
  logout: (refreshToken: string) =>
    apiClient.post('/auth/logout', { refresh_token: refreshToken }).then((r) => r.data),

  // Users
  getMe: () => apiClient.get('/users/me').then((r) => r.data),
  createUser: (data: { email: string; name: string; password: string; role?: string }) =>
    apiClient.post('/users/', data).then((r) => r.data),
  updateMe: (data: Partial<{ name: string; avatar_url: string }>) =>
    apiClient.put('/users/me', data).then((r) => r.data),
  updateReminderSettings: (reminderDays: string) =>
    apiClient.put('/users/me/reminders', { reminder_days: reminderDays }).then((r) => r.data),
  listUsers: () => apiClient.get('/users/').then((r) => r.data),
  resetUserPassword: (userId: string) =>
    apiClient.post(`/users/${userId}/reset-password`).then((r) => r.data as { temporary_password: string }),
  updateUserPermissions: (
    userId: string,
    data: Partial<{
      role: 'admin' | 'manager' | 'developer'
      can_manage_team: boolean
      can_delete: boolean
      can_import: boolean
      can_bulk_edit: boolean
    }>
  ) => apiClient.patch(`/users/${userId}/permissions`, data).then((r) => r.data),
  deactivateUser: (userId: string) => apiClient.delete(`/users/${userId}`),
  searchUsers: (q: string) => apiClient.get('/users/search', { params: { q } }).then((r) => r.data),
  globalSearch: (q: string) =>
    apiClient.get('/users/global/search', { params: { q } }).then((r) => r.data),

  // Projects
  listProjects: () => apiClient.get('/projects/').then((r) => r.data),
  createProject: (data: object) => apiClient.post('/projects/', data).then((r) => r.data),
  getProject: (id: string) => apiClient.get(`/projects/${id}`).then((r) => r.data),
  updateProject: (id: string, data: object) =>
    apiClient.put(`/projects/${id}`, data).then((r) => r.data),
  deleteProject: (id: string) => apiClient.delete(`/projects/${id}`),
  getGantt: (projectId: string) =>
    apiClient.get(`/projects/${projectId}/gantt`).then((r) => r.data),
  listMembers: (projectId: string) =>
    apiClient.get(`/projects/${projectId}/members`).then((r) => r.data),
  addMember: (projectId: string, userId: string, role: string) =>
    apiClient.post(`/projects/${projectId}/members`, { user_id: userId, role }).then((r) => r.data),
  updateMemberRole: (projectId: string, userId: string, role: string) =>
    apiClient.patch(`/projects/${projectId}/members/${userId}`, { role }).then((r) => r.data),
  removeMember: (projectId: string, userId: string) =>
    apiClient.delete(`/projects/${projectId}/members/${userId}`),
  listProjectFiles: (projectId: string) =>
    apiClient.get(`/projects/${projectId}/files`).then((r) => r.data),
  uploadProjectFile: (projectId: string, file: File) => {
    const form = new FormData()
    form.append('upload', file)
    return apiClient
      .post(`/projects/${projectId}/files`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },
  importMSProjectTasks: (projectId: string, file: File) => {
    const form = new FormData()
    form.append('upload', file)
    return apiClient
      .post(`/projects/${projectId}/tasks/import/ms-project`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },
  deleteProjectFile: (projectId: string, fileId: string) =>
    apiClient.delete(`/projects/${projectId}/files/${fileId}`),
  downloadProjectFile: (projectId: string, fileId: string) =>
    apiClient.get(`/projects/${projectId}/files/${fileId}/download`, { responseType: 'blob' }),

  // Tasks
  listTasks: (projectId: string) =>
    apiClient.get(`/projects/${projectId}/tasks`).then((r) => r.data),
  listEscalations: () => apiClient.get('/tasks/escalations/inbox').then((r) => r.data),
  createTask: (projectId: string, data: object) =>
    apiClient.post(`/projects/${projectId}/tasks`, data).then((r) => r.data),
  getTask: (taskId: string) => apiClient.get(`/tasks/${taskId}`).then((r) => r.data),
  updateTask: (taskId: string, data: object) =>
    apiClient.put(`/tasks/${taskId}`, data).then((r) => r.data),
  deleteTask: (taskId: string) => apiClient.delete(`/tasks/${taskId}`),
  updateTaskStatus: (
    taskId: string,
    data: { status: string; progress_percent?: number; next_step?: string | null }
  ) => apiClient.patch(`/tasks/${taskId}/status`, data).then((r) => r.data),
  bulkUpdateTasks: (
    projectId: string,
    data: {
      task_ids: string[]
      status?: string
      priority?: string
      control_ski?: boolean
      assigned_to_id?: string | null
      delete?: boolean
    }
  ) => apiClient.post(`/projects/${projectId}/tasks/bulk`, data).then((r) => r.data),
  listTaskComments: (taskId: string) => apiClient.get(`/tasks/${taskId}/comments`).then((r) => r.data),
  addTaskComment: (taskId: string, body: string) =>
    apiClient.post(`/tasks/${taskId}/comments`, { body }).then((r) => r.data),
  listTaskEvents: (taskId: string) => apiClient.get(`/tasks/${taskId}/events`).then((r) => r.data),
  getCriticalPath: (projectId: string) =>
    apiClient.get(`/projects/${projectId}/critical-path`).then((r) => r.data),

  // Notifications
  listNotifications: () => apiClient.get('/notifications').then((r) => r.data),
  markRead: (id: string) => apiClient.patch(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => apiClient.post('/notifications/read-all').then((r) => r.data),

  // Devices
  registerDevice: (token: string, platform: string) =>
    apiClient.post('/devices/register', { token, platform }).then((r) => r.data),

  // AI drafts
  listAIJobs: (projectId: string) =>
    apiClient.get(`/projects/${projectId}/ai-jobs`).then((r) => r.data),
  startAIProcessingForFile: (projectId: string, fileId: string) =>
    apiClient.post(`/projects/${projectId}/files/${fileId}/ai-process`).then((r) => r.data),
  listAIDrafts: (projectId: string, params?: { file_id?: string; status_filter?: string }) =>
    apiClient.get(`/projects/${projectId}/ai-drafts`, { params }).then((r) => r.data),
  approveAIDraft: (projectId: string, draftId: string) =>
    apiClient.post(`/projects/${projectId}/ai-drafts/${draftId}/approve`).then((r) => r.data),
  approveAIDraftsBulk: (projectId: string, draftIds: string[]) =>
    apiClient.post(`/projects/${projectId}/ai-drafts/approve-bulk`, { draft_ids: draftIds }).then((r) => r.data),
  rejectAIDraft: (projectId: string, draftId: string) =>
    apiClient.post(`/projects/${projectId}/ai-drafts/${draftId}/reject`).then((r) => r.data),
}
