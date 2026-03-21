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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 2) return 'только что'
  if (minutes < 60) return `${minutes} мин. назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч. назад`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} дн. назад`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} мес. назад`
  return `${Math.floor(months / 12)} г. назад`
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
          <div className="fixed inset-0 z-[999]" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-11 z-[1000] isolate w-96 max-w-[min(92vw,24rem)] rounded-xl border text-card-foreground shadow-2xl overflow-hidden"
            style={{ backgroundColor: "hsl(var(--card))", opacity: 1 }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b bg-[hsl(var(--card))]">
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

            <div className="max-h-80 overflow-y-auto divide-y bg-[hsl(var(--card))]">
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
                    'w-full text-left px-4 py-3 bg-[hsl(var(--card))] hover:bg-accent transition-colors',
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
                      {timeAgo(n.created_at)}
                    </p>
                  </div>
                  </div>
                </button>
              ))}
            </div>

            {notifications.length > 0 && (
              <div className="px-4 py-2 border-t text-xs text-muted-foreground text-center bg-[hsl(var(--card))]">
                Всего: {notifications.length} уведомлений
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
