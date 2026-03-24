import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, BarChart2, List, Users, Pencil, Paperclip, Trash2, BrainCircuit, GitBranch, Clock } from 'lucide-react'

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
}

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
}: Props) {
  return (
    <div className="flex items-center gap-4 mb-6">
      <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-5 h-5" />
      </Link>
      <div className="flex items-center gap-2 flex-1">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color }} />
        <h1 className="text-2xl font-bold">{project.name}</h1>
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
      </div>

      <div className="flex gap-1">
        <Button variant={view === 'gantt' ? 'default' : 'ghost'} size="sm" onClick={() => onViewChange('gantt')}>
          <BarChart2 className="w-4 h-4 mr-1" />
          Gantt
        </Button>
        <Button variant={view === 'list' ? 'default' : 'ghost'} size="sm" onClick={() => onViewChange('list')}>
          <List className="w-4 h-4 mr-1" />
          List
        </Button>
        <Button variant={view === 'members' ? 'default' : 'ghost'} size="sm" onClick={() => onViewChange('members')}>
          <Users className="w-4 h-4 mr-1" />
          Members
        </Button>
        <Button variant={view === 'files' ? 'default' : 'ghost'} size="sm" onClick={() => onViewChange('files')}>
          <Paperclip className="w-4 h-4 mr-1" />
          Files
        </Button>
        <Button variant={view === 'graph' ? 'default' : 'ghost'} size="sm" onClick={() => onViewChange('graph')}>
          <GitBranch className="w-4 h-4 mr-1" />
          Граф
        </Button>
        <Button variant={view === 'time' ? 'default' : 'ghost'} size="sm" onClick={() => onViewChange('time')}>
          <Clock className="w-4 h-4 mr-1" />
          Время
        </Button>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onAiAnalysis}
        disabled={aiAnalysisPending}
        title="AI-анализ проекта"
      >
        <BrainCircuit className="w-4 h-4 shrink-0 mr-1" />
        {aiAnalysisPending ? 'Анализ...' : 'AI Анализ'}
      </Button>

      <Button variant="outline" size="sm" disabled={!canManage} onClick={onEditClick}>
        <Pencil className="w-4 h-4 mr-1" />
        Редактировать
      </Button>

      {canDelete && (
        <Button variant="destructive" size="sm" onClick={onDeleteClick} disabled={deletePending}>
          <Trash2 className="w-4 h-4 mr-1" />
          {deletePending ? 'Удаление...' : 'Удалить проект'}
        </Button>
      )}

      <Button size="sm" onClick={onAddTaskClick}>
        Добавить задачу
      </Button>
    </div>
  )
}
