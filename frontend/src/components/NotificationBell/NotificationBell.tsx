import { useState } from 'react'
import { Bell } from 'lucide-react'
import { useNotifications, useMarkAllRead, useMarkRead } from '@/hooks/useNotifications'
import { cn } from '@/lib/utils'
import { useNavigate } from 'react-router-dom'

function localizeNotificationText(text: string): string {
  return text
    .replace(/^Deadline Approaching$/i, 'Срок подходит')
    .replace(/^Deadline Missed$/i, 'Срок пропущен')
    .replace(/^No notifications$/i, 'Уведомлений пока нет')
    .replace(/^Notifications$/i, 'Уведомления')
    .replace(/^Mark all read$/i, 'Отметить все')
    .replace(/Task '([^']+)' deadline is in (\d+) day\(s\)/gi, 'Срок задачи «$1» наступит через $2 дн.')
    .replace(/Task '([^']+)' deadline has passed/gi, 'Срок задачи «$1» уже прошел')
    .replace(/Check-in:/gi, 'Отчет:')
    .replace(/\bMissed\b/gi, 'Просрочено')
    .replace(/\bApproaching\b/gi, 'Скоро')
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { data: notifications = [] } = useNotifications()
  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()

  const unreadCount = notifications.filter((n) => !n.is_read).length

  const handleOpenNotification = (notification: (typeof notifications)[number]) => {
    if (!notification.is_read) {
      markRead.mutate(notification.id)
    }
    const projectId = typeof notification.data?.project_id === 'string' ? notification.data.project_id : null
    const taskId = typeof notification.data?.task_id === 'string' ? notification.data.task_id : null
    if (projectId) {
      navigate(`/projects/${projectId}${taskId ? `?task=${taskId}` : ''}`)
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg hover:bg-accent transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-11 z-20 w-96 max-w-[min(92vw,24rem)] rounded-xl border text-card-foreground shadow-xl overflow-hidden backdrop-blur-none"
            style={{ backgroundColor: 'hsl(var(--card))', opacity: 1 }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="font-semibold text-sm">Уведомления</span>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  className="text-xs text-primary hover:underline"
                >
                  Отметить все
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y">
              {notifications.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Уведомлений пока нет
                </div>
              )}
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleOpenNotification(n)}
                  className={cn(
                    'w-full text-left px-4 py-3 hover:bg-accent transition-colors',
                    !n.is_read && 'bg-primary/5'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && (
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                    )}
                  <div className={cn(!n.is_read ? '' : 'ml-4')}>
                    <p className="text-sm font-medium">{localizeNotificationText(n.title)}</p>
                    <p className="text-xs text-foreground/90">{localizeNotificationText(n.body)}</p>
                    <p className="text-[10px] text-foreground/70 mt-1">
                      {new Date(n.created_at).toLocaleString('ru-RU')}
                    </p>
                  </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
