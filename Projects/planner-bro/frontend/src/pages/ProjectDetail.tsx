import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useProject, useGantt, useTasks, useCreateTask } from '@/hooks/useProjects'
import { useMembers } from '@/hooks/useMembers'
import { GanttChart } from '@/components/GanttChart/GanttChart'
import { TaskDrawer } from '@/components/TaskDrawer/TaskDrawer'
import { MembersPanel } from '@/components/MembersPanel/MembersPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { Task, GanttTask } from '@/types'
import { ArrowLeft, Plus, BarChart2, List, Users } from 'lucide-react'

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: project } = useProject(id!)
  const { data: ganttData } = useGantt(id!)
  const { data: tasks = [] } = useTasks(id!)
  const { data: members = [] } = useMembers(id!)
  const createTask = useCreateTask()

  const [view, setView] = useState<'gantt' | 'list' | 'members'>('gantt')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    start_date: '',
    end_date: '',
    estimated_hours: '',
    assigned_to_id: '',
  })

  const handleGanttTaskClick = (ganttTask: GanttTask) => {
    const task = tasks.find((t) => t.id === ganttTask.id)
    if (task) {
      setSelectedTask(task)
      setDrawerOpen(true)
    }
  }

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task)
    setDrawerOpen(true)
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    await createTask.mutateAsync({
      projectId: id!,
      data: {
        ...taskForm,
        estimated_hours: taskForm.estimated_hours ? parseInt(taskForm.estimated_hours) : undefined,
        start_date: taskForm.start_date || undefined,
        end_date: taskForm.end_date || undefined,
        assigned_to_id: taskForm.assigned_to_id || undefined,
      },
    })
    setTaskDialogOpen(false)
    setTaskForm({ title: '', description: '', priority: 'medium', start_date: '', end_date: '', estimated_hours: '', assigned_to_id: '' })
  }

  if (!project) {
    return <div className="p-6 text-muted-foreground">Loading...</div>
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2 flex-1">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color }} />
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <Badge variant="secondary">{project.status}</Badge>
        </div>

        <div className="flex gap-1">
          <Button
            variant={view === 'gantt' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('gantt')}
          >
            <BarChart2 className="w-4 h-4 mr-1" />
            Gantt
          </Button>
          <Button
            variant={view === 'list' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('list')}
          >
            <List className="w-4 h-4 mr-1" />
            List
          </Button>
          <Button
            variant={view === 'members' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('members')}
          >
            <Users className="w-4 h-4 mr-1" />
            Members
          </Button>
        </div>

        <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-1" />
              Add Task
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Task</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div className="space-y-1">
                <Label>Title</Label>
                <Input
                  value={taskForm.title}
                  onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))}
                  required
                  placeholder="Task title"
                />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input
                  value={taskForm.description}
                  onChange={(e) => setTaskForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>
              <div className="space-y-1">
                <Label>Priority</Label>
                <select
                  value={taskForm.priority}
                  onChange={(e) => setTaskForm((f) => ({ ...f, priority: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Assignee</Label>
                <select
                  value={taskForm.assigned_to_id}
                  onChange={(e) => setTaskForm((f) => ({ ...f, assigned_to_id: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.user.id} value={m.user.id}>
                      {m.user.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={taskForm.start_date}
                    onChange={(e) => setTaskForm((f) => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>End Date</Label>
                  <Input
                    type="date"
                    value={taskForm.end_date}
                    onChange={(e) => setTaskForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Estimated Hours</Label>
                <Input
                  type="number"
                  value={taskForm.estimated_hours}
                  onChange={(e) => setTaskForm((f) => ({ ...f, estimated_hours: e.target.value }))}
                  placeholder="e.g. 8"
                />
              </div>
              <Button type="submit" className="w-full" disabled={createTask.isPending}>
                {createTask.isPending ? 'Creating...' : 'Create Task'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Description */}
      {project.description && (
        <p className="text-muted-foreground text-sm mb-6">{project.description}</p>
      )}

      {/* Content */}
      {view === 'gantt' ? (
        <div className="rounded-xl border bg-card p-4 overflow-x-auto">
          <GanttChart
            tasks={ganttData?.tasks ?? []}
            onTaskClick={handleGanttTaskClick}
          />
        </div>
      ) : view === 'list' ? (
        <div className="space-y-2">
          {tasks.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              No tasks yet. Add a task to get started.
            </div>
          )}
          {tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => handleTaskClick(task)}
              className="w-full text-left rounded-lg border bg-card p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[task.priority]}`}
                  >
                    {task.priority}
                  </span>
                  <span className="font-medium text-sm">{task.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  {task.assignee && (
                    <span className="text-xs text-muted-foreground">{task.assignee.name}</span>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {STATUS_LABELS[task.status]}
                  </Badge>
                </div>
              </div>
              {task.end_date && (
                <p className="text-xs text-muted-foreground mt-1">
                  Due: {new Date(task.end_date).toLocaleDateString()}
                </p>
              )}
            </button>
          ))}
        </div>
      ) : (
        <MembersPanel projectId={id!} />
      )}

      <TaskDrawer
        task={selectedTask}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        projectId={id!}
      />
    </div>
  )
}
