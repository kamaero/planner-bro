import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import type { AppSearchPayload } from '@/components/App/AppSidebar'

export type CommandPaletteQuickAction = {
  label: string
  description: string
  to: string
}

type CommandPaletteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onQueryChange: (value: string) => void
  data: AppSearchPayload | null
  quickActions: CommandPaletteQuickAction[]
  onOpenTarget: (to: string) => void
}

export function CommandPaletteDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  data,
  quickActions,
  onOpenTarget,
}: CommandPaletteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            Быстрый переход
          </DialogTitle>
        </DialogHeader>
        <div className="p-4">
          <Input
            autoFocus
            placeholder="Проекты, задачи, люди, разделы…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto">
            {!query.trim() && (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Быстрые разделы</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {quickActions.map((item) => (
                    <button
                      key={item.to}
                      type="button"
                      onClick={() => onOpenTarget(item.to)}
                      className="rounded-xl border bg-card px-3 py-3 text-left transition-colors hover:bg-accent"
                    >
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {query.trim() && (
              <>
                {data?.projects?.length ? (
                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Проекты</p>
                    <div className="space-y-2">
                      {data.projects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => onOpenTarget(`/projects/${project.id}`)}
                          className="w-full rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
                        >
                          <p className="text-sm font-medium">{project.name}</p>
                          <p className="text-xs text-muted-foreground">{project.status}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {data?.tasks?.length ? (
                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Задачи</p>
                    <div className="space-y-2">
                      {data.tasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => onOpenTarget(`/projects/${task.project_id}?task=${task.id}`)}
                          className="w-full rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
                        >
                          <p className="text-sm font-medium">{task.title}</p>
                          <p className="text-xs text-muted-foreground">{task.status}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {data?.users?.length ? (
                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Люди</p>
                    <div className="space-y-2">
                      {data.users.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => onOpenTarget('/team')}
                          className="w-full rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
                        >
                          <p className="text-sm font-medium">{member.name}</p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {data &&
                  data.projects.length === 0 &&
                  data.tasks.length === 0 &&
                  data.users.length === 0 && (
                    <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
                      Ничего не найдено. Попробуйте часть названия проекта, задачи или email.
                    </p>
                  )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
