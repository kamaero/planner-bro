export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'manager' | 'developer'
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
  start_date?: string
  end_date?: string
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
  status: 'todo' | 'in_progress' | 'review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'critical'
  progress_percent: number
  next_step?: string
  start_date?: string
  end_date?: string
  assigned_to_id?: string
  assignee?: User
  is_escalation?: boolean
  escalation_for?: string
  escalation_sla_hours?: number
  escalation_due_at?: string
  escalation_first_response_at?: string
  escalation_overdue_at?: string
  repeat_every_days?: number
  created_by_id: string
  estimated_hours?: number
  created_at: string
  updated_at: string
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
  created_at: string
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
