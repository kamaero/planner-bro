import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, BarChart2, List, Users, Pencil, Paperclip, Trash2, BrainCircuit, GitBranch, Clock, Printer, FileText } from 'lucide-react'

type ViewType = 'gantt' | 'list' | 'members' | 'files' | 'graph' | 'time'

interface ProjectSummary {
  color: string
  name: string
  status: string
  planning_mode?: string
  priority: string
  control_ski: boolean
  launch_basis_text?: string | null
}

interface Props {
  project: ProjectSummary
  hasLaunchBasis: boolean
  priorityColorClass: string
  view: ViewType
  onViewChange: (v: ViewType) => void
  onAiAnalysis: () => void
  aiAnalysisPending: boolean
  canManage: boolean
  onEditClick: () => void
  canDelete: boolean
  onDeleteClick: () => void
  deletePending: boolean
  onAddTaskClick: () => void
  onPrintClick: () => void
  onSummaryClick: () => void
  summaryPending: boolean
}

const VIEW_BUTTONS: { key: ViewType; icon: typeof BarChart2; label: string; title: string }[] = [
  { key: 'gantt', icon: BarChart2, label: 'Gantt', title: 'Диаграмма Ганта' },
  { key: 'list', icon: List, label: 'List', title: 'Список задач' },
  { key: 'members', icon: Users, label: 'Members', title: 'Участники' },
  { key: 'files', icon: Paperclip, label: 'Files', title: 'Файлы' },
  { key: 'graph', icon: GitBranch, label: 'Граф', title: 'Граф зависимостей' },
  { key: 'time', icon: Clock, label: 'Время', title: 'Учёт времени' },
]

export function ProjectDetailHeader({
  project,
  hasLaunchBasis,
  priorityColorClass,
  view,
  onViewChange,
  onAiAnalysis,
  aiAnalysisPending,
  canManage,
  onEditClick,
  canDelete,
  onDeleteClick,
  deletePending,
  onAddTaskClick,
  onPrintClick,
  onSummaryClick,
  summaryPending,
}: Props) {
  return (
    <div className="mb-6 space-y-3">
      {/* Row 1: back + name + actions */}
      <div className="flex items-center gap-3">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
          <h1 className="text-2xl font-bold truncate">{project.name}</h1>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canDelete && (
            <Button variant="destructive" size="sm" onClick={onDeleteClick} disabled={deletePending} title="Удалить проект">
              <Trash2 className="w-4 h-4" />
              <span className="hidden md:inline md:ml-1">{deletePending ? 'Удаление...' : 'Удалить проект'}</span>
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={!canManage} onClick={onEditClick} title="Редактировать проект">
            <Pencil className="w-4 h-4" />
            <span className="hidden md:inline md:ml-1">Редактировать</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onSummaryClick} disabled={summaryPending} title="Сводка по проекту">
            <FileText className="w-4 h-4" />
            <span className="hidden md:inline md:ml-1">{summaryPending ? 'Загрузка...' : 'Сводка'}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onPrintClick} title="Печатная форма">
            <Printer className="w-4 h-4" />
            <span className="hidden md:inline md:ml-1">Принт</span>
          </Button>
          <Button size="sm" onClick={onAddTaskClick} title="Добавить задачу">
            Добавить задачу
          </Button>
        </div>
      </div>

      {/* Row 2: badges + view buttons + ai */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{project.status}</Badge>
        <Badge variant="outline">
          {project.planning_mode === 'strict' ? 'strict' : 'flexible'}
        </Badge>
        <Badge variant="outline" className={priorityColorClass}>
          {project.control_ski ? 'critical · СКИ' : project.priority}
        </Badge>
        {hasLaunchBasis && (
          <Badge variant="outline">Основание запуска</Badge>
        )}

        <div className="flex gap-0.5 ml-1">
          {VIEW_BUTTONS.map(({ key, icon: Icon, label, title }) => (
            <Button
              key={key}
              variant={view === key ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onViewChange(key)}
              title={title}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden md:inline md:ml-1">{label}</span>
            </Button>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onAiAnalysis}
          disabled={aiAnalysisPending}
          title="AI-анализ проекта"
        >
          <BrainCircuit className="w-4 h-4 shrink-0" />
          <span className="hidden md:inline md:ml-1">
            {aiAnalysisPending ? 'Анализ...' : 'AI Анализ'}
          </span>
        </Button>
      </div>
    </div>
  )
}
