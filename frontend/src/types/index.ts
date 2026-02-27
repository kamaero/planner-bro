export interface User {
  id: string
  email: string
  work_email?: string | null
  name: string
  first_name: string
  last_name: string
  position_title?: string | null
  manager_id?: string | null
  department_id?: string | null
  role: 'admin' | 'manager' | 'developer'
  can_manage_team: boolean
  can_delete: boolean
  can_import: boolean
  can_bulk_edit: boolean
  is_active?: boolean
  avatar_url?: string
  reminder_days?: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  description?: string
  color: string
  status: 'planning' | 'active' | 'on_hold' | 'completed'
  priority: 'low' | 'medium' | 'high' | 'critical'
  control_ski: boolean
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

export interface Task {
  id: string
  project_id: string
  parent_task_id?: string
  title: string
  description?: string
  status: 'planning' | 'todo' | 'in_progress' | 'review' | 'done'
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
  created_at: string
  updated_at: string
}

export interface TaskDependency {
  predecessor_task_id: string
  successor_task_id: string
  created_at: string
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
