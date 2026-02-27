import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import type { Project } from '@/types'
import { CalendarDays, Users } from 'lucide-react'

const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  tz: 'TZ',
  active: 'Active',
  testing: 'Testing',
  on_hold: 'On Hold',
  completed: 'Completed',
}

const STATUS_COLORS: Record<string, string> = {
  planning: 'secondary',
  tz: 'outline',
  active: 'default',
  testing: 'outline',
  on_hold: 'outline',
  completed: 'secondary',
}

interface ProjectCardProps {
  project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="block rounded-xl border bg-card p-5 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: project.color }}
          />
          <h3 className="font-semibold text-card-foreground truncate">{project.name}</h3>
        </div>
        <Badge variant={STATUS_COLORS[project.status] as 'default' | 'secondary' | 'outline'}>
          {STATUS_LABELS[project.status]}
        </Badge>
      </div>

      {project.description && (
        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{project.description}</p>
      )}

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {project.start_date && project.end_date && (
          <div className="flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            <span>
              {new Date(project.start_date).toLocaleDateString()} —{' '}
              {new Date(project.end_date).toLocaleDateString()}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <Users className="w-3 h-3" />
          <span>{project.owner.name}</span>
        </div>
      </div>
    </Link>
  )
}
