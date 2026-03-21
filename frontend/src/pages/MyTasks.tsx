import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useMyTasks, useProjects } from '@/hooks/useProjects'
import { useAuthStore } from '@/store/authStore'

const STATUS_LABEL: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  todo: 'К выполнению',
  in_progress: 'В работе',
  testing: 'Тестирование',
  review: 'На проверке',
  done: 'Выполнено',
}

function formatDate(value?: string) {
  if (!value) return '—'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(dt)
}

export function MyTasks() {
  const currentUser = useAuthStore((s) => s.user)
  const { data: tasks = [], isLoading } = useMyTasks()
  const { data: projects = [] } = useProjects()

  const projectNameById = useMemo(
    () => Object.fromEntries(projects.map((project) => [project.id, project.name])),
    [projects]
  )

  const myTasks = useMemo(() => {
    if (!currentUser?.id) return []
    return tasks
      .filter((task) => {
        const assigneeIds = task.assignee_ids ?? []
        return task.assigned_to_id === currentUser.id || assigneeIds.includes(currentUser.id)
      })
      .sort((a, b) => {
        const aDone = a.status === 'done' ? 1 : 0
        const bDone = b.status === 'done' ? 1 : 0
        if (aDone !== bDone) return aDone - bDone
        return b.updated_at.localeCompare(a.updated_at)
      })
  }, [tasks, currentUser?.id])

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Мои задачи</h1>
        <p className="text-sm text-muted-foreground">Только задачи, где вы назначены исполнителем.</p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Загрузка задач...</p>}
      {!isLoading && myTasks.length === 0 && (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Назначенных задач пока нет.</div>
      )}
      {!isLoading && myTasks.length > 0 && (
        <div className="rounded-xl border bg-card overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Задача</th>
                <th className="px-3 py-2 font-medium">Проект</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium">Дедлайн</th>
                <th className="px-3 py-2 font-medium">Обновлено</th>
              </tr>
            </thead>
            <tbody>
              {myTasks.map((task) => (
                <tr key={task.id} className="border-t">
                  <td className="px-3 py-2">
                    <Link to={`/projects/${task.project_id}?task=${task.id}`} className="font-medium hover:text-primary">
                      {task.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{projectNameById[task.project_id] || task.project_id}</td>
                  <td className="px-3 py-2 text-muted-foreground">{STATUS_LABEL[task.status] || task.status}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(task.end_date)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(task.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
