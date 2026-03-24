export interface UserPermissions {
  role: string
  can_delete: boolean
  can_import: boolean
  can_bulk_edit: boolean
  can_manage_team: boolean
  visibility_scope: string
  actions: {
    create_project: boolean
    delete_project: boolean
    import_tasks: boolean
    bulk_edit_tasks: boolean
    manage_team: boolean
    manage_departments: boolean
    access_vault: boolean
    upload_vault_files: boolean
    delete_vault_files: boolean
    manage_report_settings: boolean
  }
}

export interface User {
  id: string
  email: string
  work_email?: string | null
  name: string
  first_name: string
  middle_name: string
  last_name: string
  position_title?: string | null
  manager_id?: string | null
  department_id?: string | null
  role: 'admin' | 'manager' | 'developer'
  visibility_scope?: 'own_tasks_only' | 'department_scope' | 'full_scope'
  own_tasks_visibility_enabled?: boolean
  can_manage_team: boolean
  can_delete: boolean
  can_import: boolean
  can_bulk_edit: boolean
  is_active?: boolean
  avatar_url?: string
  reminder_days?: string
  created_at: string
  updated_at: string
  last_sign_in_at?: string | null
  last_login_at?: string | null
}

export interface AuthLoginEvent {
  id: string
  user_id?: string | null
  user_name?: string | null
  user_email?: string | null
  email_entered: string
  normalized_email: string
  success: boolean
  failure_reason?: string | null
  client_ip?: string | null
  user_agent?: string | null
  created_at: string
}

export interface TempAssignee {
  id: string
  raw_name: string
  normalized_name: string
  email?: string | null
  source: string
  status: 'pending' | 'linked' | 'promoted' | 'ignored' | string
  linked_user_id?: string | null
  project_id?: string | null
  created_by_id?: string | null
  seen_count: number
  first_seen_at: string
  last_seen_at: string
  created_at: string
  updated_at: string
  linked_user?: User | null
}

export interface Project {
  id: string
  name: string
  description?: string
  color: string
  status: 'planning' | 'tz' | 'active' | 'testing' | 'on_hold' | 'completed'
  priority: 'low' | 'medium' | 'high' | 'critical'
  control_ski: boolean
  planning_mode?: 'flexible' | 'strict'
  strict_no_past_start_date?: boolean
  strict_no_past_end_date?: boolean
  strict_child_within_parent_dates?: boolean
  launch_basis_text?: string
  launch_basis_file_id?: string
  start_date?: string
  end_date?: string
  department_ids?: string[]
  completion_checklist?: Array<{ id: string; label: string; done: boolean }>
  owner_id: string
  owner: User
  created_at: string
  updated_at: string
}

export interface TaskDependency {
  predecessor_task_id: string
  successor_task_id: string
  dependency_type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish'
  lag_days: number
  created_at: string
}

export interface Task {
  id: string
  project_id: string
  parent_task_id?: string
  predecessor_ids?: string[]
  title: string
  description?: string
  status: 'planning' | 'tz' | 'todo' | 'in_progress' | 'testing' | 'review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'critical'
  control_ski: boolean
  progress_percent: number
  next_step?: string
  start_date?: string
  end_date?: string
  assigned_to_id?: string
  assignee_ids?: string[]
  assignee?: User
  assignees?: User[]
  last_comment?: string
  is_escalation?: boolean
  escalation_for?: string
  escalation_sla_hours?: number
  escalation_due_at?: string
  escalation_first_response_at?: string
  escalation_overdue_at?: string
  last_check_in_at?: string
  next_check_in_due_at?: string
  last_check_in_note?: string
  dependencies?: TaskDependency[]
  repeat_every_days?: number
  created_by_id: string
  estimated_hours?: number
  actual_hours?: number | null
  created_at: string
  updated_at: string
}

export interface Department {
  id: string
  name: string
  parent_id?: string | null
  head_user_id?: string | null
  created_at: string
}

export interface GanttTask {
  id: string
  name: string
  start: string
  end: string
  progress: number
  dependencies: string[]
  type: 'task' | 'milestone' | 'project'
  project: string
  assignee?: string
  color?: string
  priority?: string
  status?: string
}

export interface GanttData {
  tasks: GanttTask[]
}

export interface CriticalPathTask {
  id: string
  title: string
  status: string
  end_date?: string | null
}

export interface CriticalPathResponse {
  project_id: string
  length: number
  task_ids: string[]
  tasks: CriticalPathTask[]
}

export interface Notification {
  id: string
  user_id: string
  type: string
  title: string
  body: string
  data?: Record<string, unknown>
  is_read: boolean
  created_at: string
}

export interface ChatMessage {
  id: string
  room_type: 'global' | 'direct'
  sender_id: string
  sender_name: string
  recipient_id?: string | null
  body: string
  attachments?: ChatAttachment[]
  read_at?: string | null
  created_at: string
}

export interface ChatAttachment {
  id: string
  filename: string
  content_type?: string | null
  size: number
  created_at: string
  download_url: string
}

export interface ChatUnreadSummary {
  global_unread_count: number
  direct: Array<{ user_id: string; unread_count: number }>
}

export interface EmailDispatchLog {
  id: string
  recipient: string
  recipient_masked: string
  subject: string
  status: 'sent' | 'failed' | 'skipped'
  source: string
  error_text?: string | null
  payload?: Record<string, unknown> | null
  created_at: string
}

export interface SystemActivityLog {
  id: string
  source: string
  category: string
  level: 'info' | 'warning' | 'error' | string
  message: string
  details?: Record<string, unknown> | null
  created_at: string
}

export interface ReportDispatchSettings {
  smtp_enabled: boolean
  email_test_mode?: boolean
  email_test_recipient?: string
  telegram_summaries_enabled: boolean
  email_analytics_enabled: boolean
  email_analytics_recipients: string
  admin_directive?: {
    enabled: boolean
    recipient: string
    days: string[]
    time_window: '06:00-09:00' | '09:00-12:00' | '12:00-15:00' | '15:00-18:00' | string
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
}

export interface ReportDeliveryStatus {
  generated_at: string
  window_hours: number
  email_sent: number
  email_failed: number
  email_skipped: number
  telegram_sent: number
  telegram_failed: number
  last_email_sent_at?: string | null
  last_telegram_sent_at?: string | null
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface ProjectMember {
  user: User
  role: 'owner' | 'manager' | 'member'
}

export interface ProjectFile {
  id: string
  project_id: string
  filename: string
  content_type?: string
  size: number
  uploaded_by_id?: string
  uploaded_by?: User
  created_at: string
}

export interface TaskComment {
  id: string
  task_id: string
  author_id?: string
  body: string
  created_at: string
  author?: User
}

export interface TaskEvent {
  id: string
  task_id: string
  actor_id?: string
  event_type: string
  payload?: string
  reason?: string
  created_at: string
  actor?: User
}

export interface TaskBulkUpdateResult {
  requested: number
  updated: number
  deleted: number
  skipped: number
  errors?: Array<{ task_id: string; reason: string }>
}

export interface AIIngestionJob {
  id: string
  project_id: string
  project_file_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  drafts_count: number
  error_message?: string
  started_at?: string
  finished_at?: string
  created_at: string
  updated_at: string
}

export interface AITaskDraft {
  id: string
  project_id: string
  project_file_id: string
  job_id: string
  status: 'pending' | 'approved' | 'rejected'
  title: string
  description?: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  end_date?: string
  estimated_hours?: number
  assigned_to_id?: string
  assignee_hint?: string
  progress_percent: number
  next_step?: string
  source_quote?: string
  confidence: number
  raw_payload: Record<string, unknown>
  approved_task_id?: string
  approved_by_id?: string
  assignee?: User
  created_at: string
  updated_at: string
}

export interface MSProjectImportResult {
  total_in_file: number
  created: number
  linked_to_parent: number
  skipped: number
  deleted_existing: number
}

export interface ImportFilePrecheck {
  file_type: string
  detected_headers: string[]
  recognized_columns: string[]
  missing_columns: string[]
  warnings: string[]
  can_start_ai: boolean
}

export interface GlobalSearchResult {
  projects: Array<{ id: string; name: string; status: string }>
  tasks: Array<{ id: string; title: string; project_id: string; status: string }>
  users: Array<{ id: string; name: string; email: string }>
}

export interface DepartmentProjectsSection {
  department_id: string
  department_name: string
  projects: Project[]
}

export interface DepartmentProjectsResponse {
  departments: DepartmentProjectsSection[]
}

export interface DeadlineChange {
  id: string
  entity_type: 'task' | 'project'
  entity_id: string
  old_date: string
  new_date: string
  reason: string
  created_at: string
  changed_by?: User
}

export interface VaultFile {
  id: string
  name: string
  description?: string | null
  content_type?: string | null
  size: number
  folder?: string | null
  uploaded_by_id?: string | null
  uploaded_by?: User | null
  created_at: string
  updated_at: string
}

export interface VaultDownloadToken {
  token: string
  expires_in_seconds: number
  download_url: string
}

export interface DeadlineStats {
  total_shifts: number
  tasks_with_shifts: number
  projects_with_shifts: number
  avg_shift_days: number
  real_overdue_tasks: Array<{
    id: string
    title: string
    project_id: string
    original_end_date: string
    current_end_date: string | null
    shifts: number
  }>
  shifts_by_project: Array<{
    project_id: string
    project_name: string
    shifts: number
  }>
}

export interface ActivityHeatmapData {
  days: Record<string, number>
  total_events: number
}
