import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  useProject,
  useGantt,
  useTasks,
  useCreateTask,
  useUpdateProject,
  useProjectFiles,
  useUploadProjectFile,
  useDeleteProjectFile,
} from '@/hooks/useProjects'
import { useMembers } from '@/hooks/useMembers'
import { api } from '@/api/client'
import { GanttChart } from '@/components/GanttChart/GanttChart'
import { TaskDrawer } from '@/components/TaskDrawer/TaskDrawer'
import { MembersPanel } from '@/components/MembersPanel/MembersPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { Task, GanttTask, ProjectFile } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { ArrowLeft, Plus, BarChart2, List, Users, Pencil, Paperclip, Download, Trash2 } from 'lucide-react'

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

const PROJECT_STATUS_OPTIONS = [
  { value: 'planning', label: 'Планирование' },
  { value: 'active', label: 'Активный' },
  { value: 'on_hold', label: 'Пауза' },
  { value: 'completed', label: 'Завершён' },
]

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: project } = useProject(id!)
  const { data: ganttData } = useGantt(id!)
  const { data: tasks = [] } = useTasks(id!)
  const { data: members = [] } = useMembers(id!)
  const { data: files = [] } = useProjectFiles(id!)
  const createTask = useCreateTask()
  const updateProject = useUpdateProject()
  const uploadProjectFile = useUploadProjectFile()
  const deleteProjectFile = useDeleteProjectFile()
  const currentUser = useAuthStore((s) => s.user)

  const [view, setView] = useState<'gantt' | 'list' | 'members' | 'files'>('gantt')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [fileToUpload, setFileToUpload] = useState<File | null>(null)
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    start_date: '',
    end_date: '',
    estimated_hours: '',
    assigned_to_id: '',
  })
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    status: 'planning',
    start_date: '',
    end_date: '',
    owner_id: '',
  })

  const memberRole = members.find((m) => m.user.id === currentUser?.id)?.role
  const canManage = currentUser?.role === 'admin' || memberRole === 'owner' || memberRole === 'manager'

  useEffect(() => {
    if (project && editOpen) {
      setEditForm({
        name: project.name,
        description: project.description ?? '',
        status: project.status,
        start_date: project.start_date ?? '',
        end_date: project.end_date ?? '',
        owner_id: project.owner_id,
      })
    }
  }, [project, editOpen])

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

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    await updateProject.mutateAsync({
      projectId: id!,
      data: {
        name: editForm.name,
        description: editForm.description,
        status: editForm.status,
        start_date: editForm.start_date || null,
        end_date: editForm.end_date || null,
        owner_id: editForm.owner_id || null,
      },
    })
    setEditOpen(false)
  }

  const handleUploadFile = async () => {
    if (!fileToUpload) return
    await uploadProjectFile.mutateAsync({ projectId: id!, file: fileToUpload })
    setFileToUpload(null)
  }

  const handleDownload = async (file: ProjectFile) => {
    const res = await api.downloadProjectFile(id!, file.id)
    const blob = new Blob([res.data], { type: file.content_type || 'application/octet-stream' })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.URL.revokeObjectURL(url)
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
          <Button
            variant={view === 'files' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('files')}
          >
            <Paperclip className="w-4 h-4 mr-1" />
            Files
          </Button>
        </div>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={!canManage}>
              <Pencil className="w-4 h-4 mr-1" />
              Редактировать
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Редактировать проект</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpdateProject} className="space-y-4">
              <div className="space-y-1">
                <Label>Название</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Описание</Label>
                <Input
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Статус</Label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full border rounded px-2 py-2 bg-background text-sm"
                  >
                    {PROJECT_STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Ответственный</Label>
                  <select
                    value={editForm.owner_id}
                    onChange={(e) => setEditForm((f) => ({ ...f, owner_id: e.target.value }))}
                    className="w-full border rounded px-2 py-2 bg-background text-sm"
                  >
                    {members.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        {m.user.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Дата начала</Label>
                  <Input
                    type="date"
                    value={editForm.start_date}
                    onChange={(e) => setEditForm((f) => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Дата окончания</Label>
                  <Input
                    type="date"
                    value={editForm.end_date}
                    onChange={(e) => setEditForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={updateProject.isPending}>
                {updateProject.isPending ? 'Сохранение...' : 'Сохранить изменения'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

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
      ) : view === 'members' ? (
        <MembersPanel projectId={id!} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Input
                type="file"
                onChange={(e) => setFileToUpload(e.target.files?.[0] ?? null)}
              />
              <Button
                variant="outline"
                onClick={handleUploadFile}
                disabled={!fileToUpload || uploadProjectFile.isPending}
              >
                {uploadProjectFile.isPending ? 'Загрузка...' : 'Загрузить файл'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Добавляйте материалы проекта: pdf, docx, ppt и другие файлы
            </p>
          </div>

          {files.length === 0 ? (
            <div className="text-sm text-muted-foreground">Файлов пока нет.</div>
          ) : (
            <div className="space-y-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{file.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)} ·{' '}
                      {new Date(file.created_at).toLocaleDateString()} ·{' '}
                      {file.uploaded_by?.name ?? 'Неизвестно'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleDownload(file)}>
                      <Download className="w-4 h-4 mr-1" />
                      Скачать
                    </Button>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          deleteProjectFile.mutate({ projectId: id!, fileId: file.id })
                        }
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
