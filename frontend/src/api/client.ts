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
  getMyPermissions: () => apiClient.get('/users/me/permissions').then((r) => r.data),
  createUser: (
    data: {
      email: string
      work_email?: string
      name: string
      first_name?: string
      middle_name?: string
      last_name?: string
      password: string
      role?: string
      visibility_scope?: 'own_tasks_only' | 'department_scope' | 'full_scope'
      own_tasks_visibility_enabled?: boolean
      position_title?: string
      manager_id?: string
      department_id?: string
    }
  ) =>
    apiClient.post('/users/', data).then((r) => r.data),
  updateUserName: (userId: string, data: { first_name: string; middle_name?: string; last_name: string }) =>
    apiClient.patch(`/users/${userId}/name`, data).then((r) => r.data),
  updateMe: (data: Partial<{ first_name: string; middle_name: string; last_name: string; avatar_url: string }>) =>
    apiClient.put('/users/me', data).then((r) => r.data),
  changeMyPassword: (data: { current_password: string; new_password: string }) =>
    apiClient.post('/users/me/change-password', data).then((r) => r.data as { message: string }),
  updateReminderSettings: (reminderDays: string) =>
    apiClient.put('/users/me/reminders', { reminder_days: reminderDays }).then((r) => r.data),
  listUsers: () => apiClient.get('/users/').then((r) => r.data),
  listTempAssignees: (params?: { status?: string; limit?: number }) =>
    apiClient.get('/users/temp-assignees', { params }).then((r) => r.data),
  linkTempAssignee: (tempAssigneeId: string, userId: string) =>
    apiClient.patch(`/users/temp-assignees/${tempAssigneeId}/link`, { user_id: userId }).then((r) => r.data),
  ignoreTempAssignee: (tempAssigneeId: string) =>
    apiClient.patch(`/users/temp-assignees/${tempAssigneeId}/ignore`).then((r) => r.data),
  promoteTempAssignee: (
    tempAssigneeId: string,
    data: {
      email: string
      work_email?: string | null
      role?: 'admin' | 'manager' | 'developer'
      password?: string
      position_title?: string | null
      manager_id?: string | null
      department_id?: string | null
    }
  ) => apiClient.post(`/users/temp-assignees/${tempAssigneeId}/promote`, data).then((r) => r.data),
  listLoginEvents: (params?: {
    limit?: number
    user_id?: string
    success?: boolean
    email_query?: string
    from_dt?: string
    to_dt?: string
  }) => apiClient.get('/users/login-events', { params }).then((r) => r.data),
  resetUserPassword: (userId: string) =>
    apiClient.post(`/users/${userId}/reset-password`).then((r) => r.data as { temporary_password: string }),
  updateUserPermissions: (
    userId: string,
    data: Partial<{
      role: 'admin' | 'manager' | 'developer'
      visibility_scope: 'own_tasks_only' | 'department_scope' | 'full_scope'
      own_tasks_visibility_enabled: boolean
      work_email: string | null
      position_title: string | null
      manager_id: string | null
      department_id: string | null
      can_manage_team: boolean
      can_delete: boolean
      can_import: boolean
      can_bulk_edit: boolean
    }>
  ) => apiClient.patch(`/users/${userId}/permissions`, data).then((r) => r.data),
  deactivateUser: (userId: string) => apiClient.delete(`/users/${userId}`),
  searchUsers: (q: string) => apiClient.get('/users/search', { params: { q } }).then((r) => r.data),
  getOnlineUsers: () => apiClient.get('/users/online/presence').then((r) => r.data as { id: string; name: string }[]),
  listDepartments: () => apiClient.get('/users/org/departments').then((r) => r.data),
  createDepartment: (data: { name: string; parent_id?: string | null; head_user_id?: string | null }) =>
    apiClient.post('/users/org/departments', data).then((r) => r.data),
  updateDepartment: (
    id: string,
    data: Partial<{ name: string; parent_id: string | null; head_user_id: string | null }>
  ) => apiClient.patch(`/users/org/departments/${id}`, data).then((r) => r.data),
  deleteDepartment: (id: string) => apiClient.delete(`/users/org/departments/${id}`),
  getOrgTree: () => apiClient.get('/users/org/tree').then((r) => r.data),
  globalSearch: (q: string) =>
    apiClient.get('/users/global/search', { params: { q } }).then((r) => r.data),

  // Projects
  listProjects: () => apiClient.get('/projects/').then((r) => r.data),
  getDepartmentDashboard: () =>
    apiClient.get('/projects/dashboard/departments').then((r) => r.data),
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
  importMSProjectTasks: (projectId: string, file: File, replaceExisting = false) => {
    const form = new FormData()
    form.append('upload', file)
    form.append('replace_existing', replaceExisting ? 'true' : 'false')
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
  listMyTasks: () => apiClient.get('/tasks/my').then((r) => r.data),
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
  checkInTask: (
    taskId: string,
    data: {
      summary: string
      blockers?: string | null
      next_check_in_due_at?: string | null
      need_manager_help?: boolean
    }
  ) => apiClient.post(`/tasks/${taskId}/check-in`, data).then((r) => r.data),
  listTaskDependencies: (taskId: string) =>
    apiClient.get(`/tasks/${taskId}/dependencies`).then((r) => r.data),
  addTaskDependency: (
    taskId: string,
    data: {
      predecessor_task_id: string
      dependency_type?: 'finish_to_start' | 'start_to_start' | 'finish_to_finish'
      lag_days?: number
    }
  ) =>
    apiClient.post(`/tasks/${taskId}/dependencies`, data).then((r) => r.data),
  removeTaskDependency: (taskId: string, predecessorTaskId: string) =>
    apiClient.delete(`/tasks/${taskId}/dependencies/${predecessorTaskId}`),
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
  listEmailDispatchLogs: (params?: { hours?: number; limit?: number }) =>
    apiClient.get('/notifications/activity/email', { params }).then((r) => r.data),
  listSystemActivityLogs: (params?: {
    hours?: number
    limit?: number
    level?: string
    category?: string
    source?: string
    include_probe?: boolean
  }) => apiClient.get('/notifications/activity/system', { params }).then((r) => r.data),
  runSmtpHealthcheck: (data?: { recipient?: string }) =>
    apiClient.post('/notifications/activity/smtp-healthcheck', data ?? {}).then((r) => r.data),
  runAdminDirectiveTest: (data?: { recipient?: string }) =>
    apiClient.post('/notifications/admin-directive/test', data ?? {}).then((r) => r.data),
  getReportDispatchSettings: () =>
    apiClient.get('/notifications/report-settings').then((r) => r.data),
  updateReportDispatchSettings: (data: {
    smtp_enabled: boolean
    telegram_summaries_enabled: boolean
    email_analytics_enabled: boolean
    email_analytics_recipients: string
    admin_directive?: {
      enabled: boolean
      recipient: string
      days: string[]
      time_window: string
      include_overdue: boolean
      include_stale: boolean
      stale_days: number
      include_unassigned: boolean
      custom_text: string
    }
    digest_filters?: {
      deadline_window_days: number
      priorities: string[]
      include_control_ski: boolean
      include_escalations: boolean
      include_without_deadline: boolean
      anti_noise_enabled: boolean
      anti_noise_ttl_minutes: number
    }
    digest_schedule?: {
      timezone: string
      telegram_projects_enabled: boolean
      telegram_critical_enabled: boolean
      email_projects_enabled: boolean
      email_critical_enabled: boolean
      telegram_projects_slots: string[]
      telegram_critical_slots: string[]
      email_analytics_slots: string[]
    }
  }) => apiClient.put('/notifications/report-settings', data).then((r) => r.data),
  getReportDeliveryStatus: (params?: { hours?: number }) =>
    apiClient.get('/notifications/report-delivery/status', { params }).then((r) => r.data),
  reportClientError: (data: {
    message: string
    stack?: string
    url?: string
    user_agent?: string
    context?: Record<string, unknown>
  }) => apiClient.post('/notifications/activity/client-error', data).then((r) => r.data),
  markRead: (id: string) => apiClient.patch(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => apiClient.post('/notifications/read-all').then((r) => r.data),
  listGlobalChatMessages: (params?: { limit?: number }) =>
    apiClient.get('/chat/global/messages', { params }).then((r) => r.data),
  listDirectChatMessages: (peerId: string, params?: { limit?: number }) =>
    apiClient.get(`/chat/direct/${peerId}/messages`, { params }).then((r) => r.data),
  getChatUnreadSummary: () => apiClient.get('/chat/unread-summary').then((r) => r.data),
  sendChatMessage: (data: { room_type: 'global' | 'direct'; recipient_id?: string; body: string }) =>
    apiClient.post('/chat/messages', data).then((r) => r.data),
  sendChatMessageWithFile: (data: { room_type: 'global' | 'direct'; recipient_id?: string; body?: string; file: File }) => {
    const form = new FormData()
    form.append('room_type', data.room_type)
    if (data.recipient_id) form.append('recipient_id', data.recipient_id)
    if (data.body) form.append('body', data.body)
    form.append('upload', data.file)
    return apiClient
      .post('/chat/messages/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },

  // Devices
  registerDevice: (token: string, platform: string) =>
    apiClient.post('/devices/register', { token, platform }).then((r) => r.data),

  // Deadline history & stats
  listTaskDeadlineHistory: (taskId: string) =>
    apiClient.get(`/tasks/${taskId}/deadline-history`).then((r) => r.data),
  listProjectDeadlineHistory: (projectId: string) =>
    apiClient.get(`/projects/${projectId}/deadline-history`).then((r) => r.data),
  getDeadlineStats: () =>
    apiClient.get('/projects/analytics/deadline-stats-summary').then((r) => r.data),

  // AI drafts
  listAIJobs: (projectId: string) =>
    apiClient.get(`/projects/${projectId}/ai-jobs`).then((r) => r.data),
  getImportFilePrecheck: (projectId: string, fileId: string) =>
    apiClient.get(`/projects/${projectId}/files/${fileId}/import-precheck`).then((r) => r.data),
  startAIProcessingForFile: (projectId: string, fileId: string, promptInstruction?: string) =>
    apiClient
      .post(`/projects/${projectId}/files/${fileId}/ai-process`, {
        prompt_instruction: promptInstruction?.trim() || null,
      })
      .then((r) => r.data),
  listAIDrafts: (
    projectId: string,
    params?: { file_id?: string; status_filter?: string; limit?: number; offset?: number }
  ) =>
    apiClient.get(`/projects/${projectId}/ai-drafts`, { params }).then((r) => r.data),
  approveAIDraft: (projectId: string, draftId: string) =>
    apiClient.post(`/projects/${projectId}/ai-drafts/${draftId}/approve`).then((r) => r.data),
  approveAIDraftsBulk: (projectId: string, draftIds: string[]) =>
    apiClient.post(`/projects/${projectId}/ai-drafts/approve-bulk`, { draft_ids: draftIds }).then((r) => r.data),
  rejectAIDraft: (projectId: string, draftId: string) =>
    apiClient.post(`/projects/${projectId}/ai-drafts/${draftId}/reject`).then((r) => r.data),
  rejectAIDraftsBulk: (projectId: string, draftIds: string[]) =>
    apiClient.post(`/projects/${projectId}/ai-drafts/reject-bulk`, { draft_ids: draftIds }).then((r) => r.data),

  // Vault (encrypted team file storage)
  listVaultFiles: (folder?: string) =>
    apiClient.get('/vault/files', { params: folder ? { folder } : {} }).then((r) => r.data),
  uploadVaultFile: (file: File, folder?: string, description?: string) => {
    const form = new FormData()
    form.append('upload', file)
    const params: Record<string, string> = {}
    if (folder) params.folder = folder
    if (description) params.description = description
    return apiClient
      .post('/vault/files', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        params,
      })
      .then((r) => r.data)
  },
  getVaultDownloadToken: (fileId: string) =>
    apiClient.get(`/vault/files/${fileId}/token`).then((r) => r.data),
  deleteVaultFile: (fileId: string) => apiClient.delete(`/vault/files/${fileId}`),

  // Analytics
  getActivityHeatmap: (days?: number) =>
    apiClient
      .get('/analytics/activity-heatmap', { params: days ? { days } : {} })
      .then((r) => r.data),

  // AI Project Manager
  analyzeProject: (projectId: string) =>
    apiClient.post(`/projects/${projectId}/ai-analysis`).then((r) => r.data),
}
