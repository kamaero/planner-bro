import { Button } from '@/components/ui/button'
import { formatUserDisplayName } from '@/lib/userName'
import type { DeadlineChange, Project, ProjectFile } from '@/types'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'

type ProjectProgressStats = {
  completedCount: number
  zeroProgressCount: number
  totalCount: number
}

type ProjectDetailSummaryCardProps = {
  project: Project
  projectProgress: number
  progressStats: ProjectProgressStats
  projectDeadlineHistory: DeadlineChange[]
  showProjectDeadlineHistory: boolean
  onToggleProjectDeadlineHistory: () => void
  launchBasisFile: ProjectFile | null
  onDownloadLaunchBasis: (file: ProjectFile) => void
}

export function ProjectDetailSummaryCard({
  project,
  projectProgress,
  progressStats,
  projectDeadlineHistory,
  showProjectDeadlineHistory,
  onToggleProjectDeadlineHistory,
  launchBasisFile,
  onDownloadLaunchBasis,
}: ProjectDetailSummaryCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4 mb-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm font-semibold">Прогресс проекта: {projectProgress}%</div>
          <div className="text-sm text-muted-foreground">Выполнено 100%: {progressStats.completedCount}</div>
          <div className="text-sm text-muted-foreground">Без движения (0%): {progressStats.zeroProgressCount}</div>
          <div className="text-sm text-muted-foreground">Всего задач: {progressStats.totalCount}</div>
          {project.end_date && (
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              Дедлайн: {new Date(project.end_date).toLocaleDateString('ru-RU')}
              {projectDeadlineHistory.length > 0 && (
                <span className="text-xs text-amber-600 font-medium ml-1">
                  (переносился {projectDeadlineHistory.length}×)
                </span>
              )}
            </div>
          )}
          {(project.launch_basis_text || launchBasisFile) && (
            <div className="text-sm text-muted-foreground">
              {project.launch_basis_text ? project.launch_basis_text : ''}
            </div>
          )}
        </div>
        {launchBasisFile && (
          <Button size="sm" variant="outline" onClick={() => onDownloadLaunchBasis(launchBasisFile)}>
            <Download className="w-4 h-4 mr-1" />
            Скачать основание
          </Button>
        )}
      </div>
      <div className="mt-3 h-2 w-full bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${projectProgress}%` }} />
      </div>

      {projectDeadlineHistory.length > 0 && (
        <div className="mt-3 rounded border bg-muted/30">
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={onToggleProjectDeadlineHistory}
          >
            <span>История переносов дедлайна проекта ({projectDeadlineHistory.length})</span>
            {showProjectDeadlineHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showProjectDeadlineHistory && (
            <div className="px-3 pb-2 space-y-1.5 border-t">
              {projectDeadlineHistory.map((change) => (
                <div key={change.id} className="pt-2 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>
                      {new Date(change.created_at).toLocaleDateString('ru-RU')}
                      {change.changed_by && ` · ${formatUserDisplayName(change.changed_by)}`}
                    </span>
                    <span>
                      {new Date(change.old_date).toLocaleDateString('ru-RU')} →{' '}
                      {new Date(change.new_date).toLocaleDateString('ru-RU')}
                    </span>
                  </div>
                  <p className="text-foreground mt-0.5 italic">"{change.reason}"</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
