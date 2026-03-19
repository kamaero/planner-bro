import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { Department, Project, SystemActivityLog } from '@/types'

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function isDigestQueueLog(item: SystemActivityLog): boolean {
  return item.source === 'analytics_email' && item.message.toLowerCase().includes('email digest queue tick')
}

type DashboardSystemLogDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  detailedSystemActivity: SystemActivityLog[]
}

export function DashboardSystemLogDialog({
  open,
  onOpenChange,
  detailedSystemActivity,
}: DashboardSystemLogDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>System log (последние 24 часа)</DialogTitle>
        </DialogHeader>
        <div className="max-h-[62vh] overflow-auto rounded-md border bg-background p-2">
          {detailedSystemActivity.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">[idle] Нет системных событий за последние 24 часа</p>
          ) : (
            detailedSystemActivity.map((item, index) => (
              <div
                key={item.id}
                className={cn(
                  'px-2 py-1.5 text-xs',
                  isDigestQueueLog(item) && 'rounded border border-cyan-500/40 bg-cyan-500/10'
                )}
              >
                <p className="leading-relaxed">
                  {new Intl.DateTimeFormat('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(item.created_at))}{' '}
                  [{item.level}] {item.category}/{item.source} :: {item.message}
                </p>
                {item.details && Object.keys(item.details).length > 0 && (
                  <pre className="mt-1 overflow-auto rounded border bg-muted/30 px-2 py-1 text-[11px] whitespace-pre-wrap break-words">
                    {JSON.stringify(item.details, null, 2)}
                  </pre>
                )}
                {index < detailedSystemActivity.length - 1 && (
                  <div className="my-2 text-muted-foreground">────────────────────────────────────────</div>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

type DashboardAssignDepartmentsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  assignProject: Project | null
  departments: Department[]
  assignDepartmentIds: string[]
  updateProjectPending: boolean
  onToggleDepartment: (departmentId: string, checked: boolean) => void
  onSave: () => void
}

export function DashboardAssignDepartmentsDialog({
  open,
  onOpenChange,
  assignProject,
  departments,
  assignDepartmentIds,
  updateProjectPending,
  onToggleDepartment,
  onSave,
}: DashboardAssignDepartmentsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Назначить отделы проекту</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{assignProject?.name}</p>
        <div className="max-h-56 space-y-2 overflow-auto rounded border p-2 text-sm">
          {departments.map((dep) => (
            <label key={dep.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={assignDepartmentIds.includes(dep.id)}
                onChange={(e) => onToggleDepartment(dep.id, e.target.checked)}
              />
              {dep.name}
            </label>
          ))}
        </div>
        <Button onClick={onSave} disabled={updateProjectPending}>
          {updateProjectPending ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
