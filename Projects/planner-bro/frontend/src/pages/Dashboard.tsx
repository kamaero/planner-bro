import { useState } from 'react'
import { useProjects, useCreateProject } from '@/hooks/useProjects'
import { ProjectCard } from '@/components/ProjectCard/ProjectCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Plus, LayoutGrid, List } from 'lucide-react'

const DEFAULT_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6']

export function Dashboard() {
  const { data: projects = [], isLoading } = useProjects()
  const createProject = useCreateProject()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    color: '#6366f1',
    start_date: '',
    end_date: '',
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    await createProject.mutateAsync({
      ...form,
      start_date: form.start_date || undefined,
      end_date: form.end_date || undefined,
    })
    setDialogOpen(false)
    setForm({ name: '', description: '', color: '#6366f1', start_date: '', end_date: '' })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading projects...
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground text-sm">{projects.length} projects</p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-1" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Project</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="Project name"
                />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>
              <div className="space-y-1">
                <Label>Color</Label>
                <div className="flex gap-2">
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        form.color === c ? 'border-foreground scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>End Date</Label>
                  <Input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={createProject.isPending}>
                {createProject.isPending ? 'Creating...' : 'Create Project'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg mb-2">No projects yet</p>
          <p className="text-sm">Create your first project to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}
