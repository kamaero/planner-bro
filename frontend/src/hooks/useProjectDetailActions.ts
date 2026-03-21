import { useState, type FormEvent } from 'react'
import { humanizeApiError } from '@/lib/errorMessages'
import type { ProjectEditFormState } from '@/components/ProjectEditDialog/ProjectEditDialog'
import type { ProjectTaskFormState } from '@/components/ProjectTaskCreateDialog/ProjectTaskCreateDialog'

const DEFAULT_TASK_FORM: ProjectTaskFormState = {
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
}

type UseProjectDetailActionsParams = {
  projectId: string
  canManage: boolean
  canDelete: boolean
  canTransferOwnership: boolean
  currentProjectOwnerId?: string
  editForm: ProjectEditFormState
  setEditOpen: (open: boolean) => void
  setTaskDialogOpen: (open: boolean) => void
  setTaskForm: (updater: ProjectTaskFormState) => void
  navigateToRoot: () => void
  createTask: (payload: { projectId: string; data: Record<string, unknown> }) => Promise<unknown>
  updateProject: (payload: { projectId: string; data: Record<string, unknown> }) => Promise<unknown>
  deleteProject: (projectId: string) => Promise<unknown>
}

export function useProjectDetailActions({
  projectId,
  canManage,
  canDelete,
  canTransferOwnership,
  currentProjectOwnerId,
  editForm,
  setEditOpen,
  setTaskDialogOpen,
  setTaskForm,
  navigateToRoot,
  createTask,
  updateProject,
  deleteProject,
}: UseProjectDetailActionsParams) {
  const [showProjectDeadlineModal, setShowProjectDeadlineModal] = useState(false)
  const [pendingProjectFormData, setPendingProjectFormData] = useState<Record<string, unknown> | null>(null)

  const handleCreateTask = async (e: FormEvent, taskForm: ProjectTaskFormState) => {
    e.preventDefault()
    try {
      await createTask({
        projectId,
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
      setTaskForm(DEFAULT_TASK_FORM)
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось создать задачу'))
    }
  }

  const handleUpdateProject = async (e: FormEvent, projectEndDate?: string) => {
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
          owner_id: canTransferOwnership ? editForm.owner_id || null : currentProjectOwnerId ?? editForm.owner_id,
          completion_checklist: editForm.completion_checklist,
        }
      : { name: editForm.name }

    const endDateChanged = editForm.end_date !== (projectEndDate ?? '') && editForm.end_date
    if (canManage && endDateChanged) {
      setPendingProjectFormData(formData)
      setShowProjectDeadlineModal(true)
      return
    }

    setEditOpen(false)
    try {
      await updateProject({ projectId, data: formData })
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
      await updateProject({
        projectId,
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
    if (!canManage || !canDelete) return
    if (!window.confirm('Удалить проект? Это действие нельзя отменить.')) return
    try {
      await deleteProject(projectId)
      navigateToRoot()
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось удалить проект'))
    }
  }

  return {
    showProjectDeadlineModal,
    pendingProjectFormData,
    handleCreateTask,
    handleUpdateProject,
    handleProjectDeadlineConfirm,
    handleProjectDeadlineCancel,
    handleDeleteProject,
  }
}
