import { Button } from '@/components/ui/button'
import { formatUserDisplayName } from '@/lib/userName'
import { Download, ChevronDown, ChevronUp } from 'lucide-react'
import type { ProjectFile } from '@/types'

interface DeadlineChange {
  id: string
  created_at: string
  old_date: string
  new_date: string
  reason: string
  changed_by?: { id: string; name: string; email: string; display_name?: string | null } | null
}

interface ProgressStats {
  completedCount: number
  zeroProgressCount: number
  totalCount: number
}

interface Props {
  projectProgress: number
  progressStats: ProgressStats
  endDate?: string | null
  launchBasisText?: string | null
  launchBasisFile?: ProjectFile | null
  deadlineHistory: DeadlineChange[]
  showDeadlineHistory: boolean
  onToggleDeadlineHistory: () => void
  onDownload: (file: ProjectFile) => void
}

export function ProjectSummaryCard({
  projectProgress,
  progressStats,
  endDate,
  launchBasisText,
  launchBasisFile,
  deadlineHistory,
  showDeadlineHistory,
  onToggleDeadlineHistory,
  onDownload,
}: Props) {
  return (
    <div className="rounded-lg border bg-card p-4 mb-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm font-semibold">Прогресс проекта: {projectProgress}%</div>
          <div className="text-sm text-muted-foreground">Выполнено 100%: {progressStats.completedCount}</div>
          <div className="text-sm text-muted-foreground">Без движения (0%): {progressStats.zeroProgressCount}</div>
          <div className="text-sm text-muted-foreground">Всего задач: {progressStats.totalCount}</div>
          {endDate && (
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              Дедлайн: {new Date(endDate).toLocaleDateString('ru-RU')}
              {deadlineHistory.length > 0 && (
                <span className="text-xs text-amber-600 font-medium ml-1">
                  (переносился {deadlineHistory.length}×)
                </span>
              )}
            </div>
          )}
          {(launchBasisText || launchBasisFile) && (
            <div className="text-sm text-muted-foreground">
              {launchBasisText ? launchBasisText : ''}
            </div>
          )}
        </div>
        {launchBasisFile && (
          <Button size="sm" variant="outline" onClick={() => onDownload(launchBasisFile)}>
            <Download className="w-4 h-4 mr-1" />
            Скачать основание
          </Button>
        )}
      </div>
      <div className="mt-3 h-2 w-full bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${projectProgress}%` }} />
      </div>

      {deadlineHistory.length > 0 && (
        <div className="mt-3 rounded border bg-muted/30">
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={onToggleDeadlineHistory}
          >
            <span>История переносов дедлайна проекта ({deadlineHistory.length})</span>
            {showDeadlineHistory ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
          {showDeadlineHistory && (
            <div className="px-3 pb-2 space-y-1.5 border-t">
              {deadlineHistory.map((change) => (
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
