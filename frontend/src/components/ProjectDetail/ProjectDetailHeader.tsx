import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TASK_PRIORITY_BADGE_COLORS } from '@/lib/domainMeta'
import type { Project } from '@/types'
import { ArrowLeft, BarChart2, List, Users, Paperclip } from 'lucide-react'

export type ProjectDetailView = 'gantt' | 'list' | 'members' | 'files'

type ProjectDetailHeaderProps = {
  project: Project
  view: ProjectDetailView
  onViewChange: (view: ProjectDetailView) => void
  hasLaunchBasis: boolean
  actions?: ReactNode
}

export function ProjectDetailHeader({
  project,
  view,
  onViewChange,
  hasLaunchBasis,
  actions,
}: ProjectDetailHeaderProps) {
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
        <Badge
          variant="outline"
          className={TASK_PRIORITY_BADGE_COLORS[project.control_ski ? 'critical' : project.priority]}
        >
          {project.control_ski ? 'critical · СКИ' : project.priority}
        </Badge>
        {hasLaunchBasis && <Badge variant="outline">Основание запуска</Badge>}
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
        <Button
          variant={view === 'members' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewChange('members')}
        >
          <Users className="w-4 h-4 mr-1" />
          Members
        </Button>
        <Button variant={view === 'files' ? 'default' : 'ghost'} size="sm" onClick={() => onViewChange('files')}>
          <Paperclip className="w-4 h-4 mr-1" />
          Files
        </Button>
      </div>

      {actions}
    </div>
  )
}
