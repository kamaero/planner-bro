import type { ComponentProps } from 'react'
import { MembersPanel } from '@/components/MembersPanel/MembersPanel'
import { ProjectFilesSection } from '@/components/ProjectFilesSection/ProjectFilesSection'
import { ProjectDetailGanttSection } from '@/components/ProjectDetail/ProjectDetailGanttSection'
import { ProjectDetailTaskListSection } from '@/components/ProjectDetail/ProjectDetailTaskListSection'

export type ProjectDetailView = 'gantt' | 'list' | 'members' | 'files'

type ProjectDetailContentProps = {
  projectId: string
  view: ProjectDetailView
  canImport: boolean
  canManage: boolean
  ganttSectionProps: ComponentProps<typeof ProjectDetailGanttSection>
  taskListSectionProps: ComponentProps<typeof ProjectDetailTaskListSection>
}

export function ProjectDetailContent({
  projectId,
  view,
  canImport,
  canManage,
  ganttSectionProps,
  taskListSectionProps,
}: ProjectDetailContentProps) {
  if (view === 'gantt') return <ProjectDetailGanttSection {...ganttSectionProps} />
  if (view === 'list') return <ProjectDetailTaskListSection {...taskListSectionProps} />
  if (view === 'members') return <MembersPanel projectId={projectId} />
  return <ProjectFilesSection projectId={projectId} canImport={canImport} canManage={canManage} />
}
