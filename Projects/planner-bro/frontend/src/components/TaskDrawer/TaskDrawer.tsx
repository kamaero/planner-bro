import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useUpdateTaskStatus, useDeleteTask, useUpdateTask } from '@/hooks/useProjects'
import { useMembers } from '@/hooks/useMembers'
import type { Task } from '@/types'
import { CalendarDays, Clock, User, Trash2 } from 'lucide-react'

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

const STATUS_OPTIONS = ['todo', 'in_progress', 'review', 'done'] as const

interface TaskDrawerProps {
  task: Task | null
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
}

export function TaskDrawer({ task, open, onOpenChange, projectId }: TaskDrawerProps) {
  const updateStatus = useUpdateTaskStatus()
  const deleteTask = useDeleteTask()
  const updateTask = useUpdateTask()
  const { data: members = [] } = useMembers(projectId)

  if (!task) return null

  const handleStatusChange = (status: string) => {
    updateStatus.mutate({ taskId: task.id, status })
  }

  const handleAssigneeChange = (assignedToId: string) => {
    updateTask.mutate({
      taskId: task.id,
      data: { assigned_to_id: assignedToId || null },
    })
  }

  const handleDelete = async () => {
    if (window.confirm('Delete this task?')) {
      await deleteTask.mutateAsync(task.id)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Priority & Status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${PRIORITY_COLORS[task.priority]}`}>
              {task.priority}
            </span>
            <select
              value={task.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="text-sm border rounded px-2 py-1 bg-background"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          {task.description && (
            <p className="text-sm text-muted-foreground">{task.description}</p>
          )}

          {/* Meta */}
          <div className="space-y-2 text-sm">
            {/* Assignee selector */}
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground shrink-0" />
              <select
                value={task.assigned_to_id ?? ''}
                onChange={(e) => handleAssigneeChange(e.target.value)}
                className="text-sm border rounded px-2 py-1 bg-background flex-1"
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </div>
            {(task.start_date || task.end_date) && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarDays className="w-4 h-4" />
                <span>
                  {task.start_date ?? '?'} — {task.end_date ?? '?'}
                </span>
              </div>
            )}
            {task.estimated_hours && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>{task.estimated_hours}h estimated</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end pt-2">
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              <Trash2 className="w-4 h-4 mr-1" />
              Delete
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
