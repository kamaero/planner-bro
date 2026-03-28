import { BrainCircuit, X } from 'lucide-react'

interface AiAnalysisResult {
  analysis: string
  stats: Record<string, number>
  generated_at: string
}

interface Props {
  result: AiAnalysisResult
  onClose: () => void
}

export function ProjectAiAnalysisModal({ result, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-primary" />
            <span className="font-semibold">AI-анализ проекта</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>Задач: {result.stats.total_tasks}</span>
              <span>Выполнено: {result.stats.done_percent}%</span>
              {result.stats.overdue_count > 0 && (
                <span className="text-destructive">Просрочено: {result.stats.overdue_count}</span>
              )}
              {result.stats.stale_count > 0 && (
                <span className="text-yellow-600">Зависших: {result.stats.stale_count}</span>
              )}
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">
          <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{result.analysis}</pre>
        </div>
        <div className="px-5 py-3 border-t text-xs text-muted-foreground">
          Сгенерировано: {new Date(result.generated_at).toLocaleString('ru-RU')}
        </div>
      </div>
    </div>
  )
}
