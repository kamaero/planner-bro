import { useEffect, useState } from 'react'
import type { GanttTask, Task } from '@/types'

type UseProjectDetailTaskSelectionParams = {
  locationSearch: string
  tasks: Task[]
}

export function useProjectDetailTaskSelection({
  locationSearch,
  tasks,
}: UseProjectDetailTaskSelectionParams) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(locationSearch)
    const taskId = params.get('task')
    if (!taskId || tasks.length === 0) return
    const task = tasks.find((item) => item.id === taskId)
    if (!task) return
    setSelectedTask(task)
    setDrawerOpen(true)
  }, [locationSearch, tasks])

  useEffect(() => {
    if (!selectedTask) return
    const updated = tasks.find((task) => task.id === selectedTask.id)
    if (updated) setSelectedTask(updated)
  }, [tasks, selectedTask])

  const openTask = (task: Task) => {
    setSelectedTask(task)
    setDrawerOpen(true)
  }

  const handleGanttTaskClick = (ganttTask: GanttTask) => {
    const task = tasks.find((item) => item.id === ganttTask.id)
    if (task) openTask(task)
  }

  const handleTaskClick = (task: Task) => {
    openTask(task)
  }

  return {
    selectedTask,
    drawerOpen,
    setDrawerOpen,
    handleGanttTaskClick,
    handleTaskClick,
  }
}
