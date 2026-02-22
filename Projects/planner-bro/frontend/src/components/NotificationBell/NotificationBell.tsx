import { useState } from 'react'
import { Bell } from 'lucide-react'
import { useNotifications, useMarkAllRead, useMarkRead } from '@/hooks/useNotifications'
import { cn } from '@/lib/utils'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { data: notifications = [] } = useNotifications()
  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()

  const unreadCount = notifications.filter((n) => !n.is_read).length

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
          <div className="absolute right-0 top-11 z-20 w-80 rounded-xl border bg-popover shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  className="text-xs text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y">
              {notifications.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No notifications
                </div>
              )}
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => !n.is_read && markRead.mutate(n.id)}
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
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="text-xs text-muted-foreground">{n.body}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {new Date(n.created_at).toLocaleString()}
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
