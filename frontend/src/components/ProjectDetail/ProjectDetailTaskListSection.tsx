import type { ComponentProps } from 'react'
import { ProjectTaskListToolbar } from '@/components/ProjectTaskListToolbar/ProjectTaskListToolbar'
import { TaskTable } from '@/components/TaskTable/TaskTable'

type ProjectDetailTaskListSectionProps = {
  toolbarProps: ComponentProps<typeof ProjectTaskListToolbar>
  tableProps: ComponentProps<typeof TaskTable>
}

export function ProjectDetailTaskListSection({
  toolbarProps,
  tableProps,
}: ProjectDetailTaskListSectionProps) {
  return (
    <div className="space-y-3">
      <ProjectTaskListToolbar {...toolbarProps} />
      <TaskTable {...tableProps} />
    </div>
  )
}
