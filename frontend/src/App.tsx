import { useEffect, useMemo, useRef, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useThemeStore } from '@/store/themeStore'
import { api } from '@/api/client'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { MyTasks } from '@/pages/MyTasks'
import { ProjectDetail } from '@/pages/ProjectDetail'
import { Team } from '@/pages/Team'
import { TeamBoard } from '@/pages/TeamBoard'
import { Analytics } from '@/pages/Analytics'
import { TeamStorage } from '@/pages/TeamStorage'
import { Chat } from '@/pages/Chat'
import { Help } from '@/pages/Help'
import { WorkloadCalendar } from '@/pages/WorkloadCalendar'
import { Roadmap } from '@/pages/Roadmap'
import { NotificationBell } from '@/components/NotificationBell/NotificationBell'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatUserDisplayName } from '@/lib/userName'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useQuery } from '@tanstack/react-query'
import type { ChatUnreadSummary, User } from '@/types'
import { Link, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  BarChart2,
  PencilRuler,
  Lock,
  Moon,
  Sun,
  MessageSquare,
  ClipboardList,
  HelpCircle,
  CalendarDays,
  Milestone,
} from 'lucide-react'

function ThemeToggle() {
  const { theme, toggleTheme } = useThemeStore()
  return (
    <button
      onClick={toggleTheme}
      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const location = useLocation()
  if (!accessToken) return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, refreshToken, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchQuery, setSearchQuery] = useState('')
  const clientErrorFloodGuardRef = useRef<Record<string, number>>({})
  const searchRef = useRef<HTMLDivElement>(null)
  const [searchData, setSearchData] = useState<{
    projects: Array<{ id: string; name: string; status: string; end_date?: string | null }>
    tasks: Array<{ id: string; title: string; project_id: string; project_name: string; status: string; end_date?: string | null; assignee_name?: string | null }>
    users: Array<{ id: string; name: string; email: string }>
  } | null>(null)
  useWebSocket()

  const { data: onlineUsers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['online-users'],
    queryFn: api.getOnlineUsers,
    refetchInterval: 30_000,
  })
  const { data: teamUsers = [] } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: api.listUsers,
    refetchInterval: 60_000,
  })
  const { data: chatUnread } = useQuery<ChatUnreadSummary>({
    queryKey: ['chat', 'unread'],
    queryFn: api.getChatUnreadSummary,
    refetchInterval: 10_000,
  })

  const handleLogout = async () => {
    if (refreshToken) {
      try {
        await api.logout(refreshToken)
      } catch {
        // local logout still proceeds
      }
    }
    logout()
    navigate('/login')
  }

  const navItems = [
    ...(user?.visibility_scope === 'own_tasks_only' && user?.own_tasks_visibility_enabled !== false
      ? [{ to: '/my-tasks', label: 'Мои задачи', icon: ClipboardList }]
      : []),
    { to: '/', label: 'Проекты', icon: LayoutDashboard },
    { to: '/my-tasks', label: 'Мои задачи', icon: ClipboardList },
    { to: '/roadmap', label: 'Roadmap', icon: Milestone },
    { to: '/analytics', label: 'Аналитика', icon: BarChart2 },
    { to: '/workload', label: 'Загрузка', icon: CalendarDays },
    { to: '/team', label: 'Команда', icon: Users },
    { to: '/team-board', label: 'Доска команды', icon: PencilRuler },
    { to: '/storage', label: 'Хранилище', icon: Lock },
    { to: '/help', label: 'Помощь', icon: HelpCircle },
  ]

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      if (!searchQuery.trim()) {
        setSearchData(null)
        return
      }
      try {
        const res = await api.globalSearch(searchQuery.trim())
        if (!cancelled) setSearchData(res)
      } catch {
        if (!cancelled) setSearchData(null)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchQuery])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSearchQuery(''); setSearchData(null) }
    }
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchQuery(''); setSearchData(null)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [])

  useEffect(() => {
    const reportClientError = (payload: {
      message: string
      stack?: string
      context?: Record<string, unknown>
    }) => {
      const key = `${payload.message}::${payload.stack ?? ''}`.slice(0, 500)
      const now = Date.now()
      const last = clientErrorFloodGuardRef.current[key] ?? 0
      if (now - last < 60_000) return
      clientErrorFloodGuardRef.current[key] = now
      void api.reportClientError({
        message: payload.message,
        stack: payload.stack,
        url: window.location.href,
        user_agent: navigator.userAgent,
        context: payload.context,
      }).catch(() => {
        // do not break UX if telemetry endpoint fails
      })
    }

    const onWindowError = (event: ErrorEvent) => {
      reportClientError({
        message: event.message || 'window.error',
        stack: event.error?.stack,
        context: { type: 'window.error', filename: event.filename, lineno: event.lineno, colno: event.colno },
      })
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message =
        typeof reason === 'string'
          ? reason
          : typeof reason?.message === 'string'
            ? reason.message
            : 'Unhandled promise rejection'
      const stack = typeof reason?.stack === 'string' ? reason.stack : undefined
      reportClientError({
        message,
        stack,
        context: { type: 'unhandledrejection' },
      })
    }

    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  const onlineUserIds = new Set(onlineUsers.map((u) => u.id))
  const teamList = [...teamUsers]
    .filter((u) => u.is_active !== false)
    .sort((a, b) => formatUserDisplayName(a).localeCompare(formatUserDisplayName(b), 'ru'))
  const teamChatList = teamList.filter((u) => u.id !== user?.id)
  const unreadDirectMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of chatUnread?.direct ?? []) map.set(item.user_id, item.unread_count)
    return map
  }, [chatUnread])

  const openDirectChat = (member: User) => {
    navigate(`/chat?mode=direct&peer=${member.id}`)
  }

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-64 border-r bg-card/60 flex flex-col h-screen sticky top-0">
        <div className="px-4 py-4 flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">
              PB
            </div>
            <div>
              <div className="text-sm font-semibold leading-none">Planner Bro</div>
              <div className="text-xs text-muted-foreground mt-1">ИТ отдел</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
          </div>
        </div>
        <div className="px-3 pb-3" ref={searchRef}>
          <div className="relative">
            <Input
              placeholder="Поиск проектов и задач..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchData && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border bg-card shadow-md p-2 space-y-2 max-h-96 overflow-auto">
                {searchData.projects.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 mb-1">Проекты</p>
                    {searchData.projects.map((p) => (
                      <Link
                        key={p.id}
                        to={`/projects/${p.id}`}
                        className="block px-2 py-1.5 rounded hover:bg-accent transition-colors"
                        onClick={() => { setSearchQuery(''); setSearchData(null) }}
                      >
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {p.status}{p.end_date ? ` · до ${new Date(p.end_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : ''}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
                {searchData.tasks.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 mb-1">Задачи</p>
                    {searchData.tasks.map((t) => (
                      <Link
                        key={t.id}
                        to={`/projects/${t.project_id}`}
                        className="block px-2 py-1.5 rounded hover:bg-accent transition-colors"
                        onClick={() => { setSearchQuery(''); setSearchData(null) }}
                      >
                        <p className="text-sm font-medium truncate">{t.title}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {t.project_name}
                          {t.status ? ` · ${t.status}` : ''}
                          {t.assignee_name ? ` · ${t.assignee_name}` : ''}
                          {t.end_date ? ` · до ${new Date(t.end_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : ''}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
                {searchData.projects.length === 0 && searchData.tasks.length === 0 && (
                  <p className="text-sm text-muted-foreground px-2 py-1">Ничего не найдено.</p>
                )}
              </div>
            )}
          </div>
        </div>
        <nav className="px-3 space-y-1">
          {navItems.map((item) => {
            const active =
              item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
            const Icon = item.icon
            const className = `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`

            return (
              <Link key={item.to} to={item.to} className={className}>
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            )
          })}
          <Link
            to="/chat"
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              location.pathname.startsWith('/chat')
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            Общий чат
            {(chatUnread?.global_unread_count ?? 0) > 0 && (
              <span className="ml-auto rounded-full bg-primary px-1.5 py-0 text-[10px] text-primary-foreground">
                {chatUnread?.global_unread_count}
              </span>
            )}
          </Link>
        </nav>
        <div className="mt-4 border-t flex-1 min-h-0 flex flex-col">
          <div className="px-4 py-4 flex items-center gap-3 border-b">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{formatUserDisplayName(user)}</p>
              <p className="text-xs text-muted-foreground truncate">Участник команды</p>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Выйти
              </button>
            </div>
            <NotificationBell />
          </div>
          <div className="px-4 py-3 space-y-4 flex-1 overflow-y-auto">
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Команда · {teamList.length} · Онлайн {onlineUsers.length}
                </p>
              </div>
              <div className="space-y-1.5">
                {teamChatList.map((member) => {
                  const isOnline = onlineUserIds.has(member.id)
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => openDirectChat(member)}
                      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-sm text-muted-foreground hover:bg-accent"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}
                      />
                      <span className="truncate">{formatUserDisplayName(member)}</span>
                      {(unreadDirectMap.get(member.id) ?? 0) > 0 && (
                        <span className="ml-auto rounded-full bg-primary px-1.5 py-0 text-[10px] text-primary-foreground">
                          {unreadDirectMap.get(member.id)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </section>

          </div>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 bg-muted/30">{children}</main>
      </div>
    </div>
  )
}

export function App() {
  const { accessToken, refreshToken, user, setTokens, setUser, logout } = useAuthStore()
  const { theme } = useThemeStore()
  const [authBootstrapped, setAuthBootstrapped] = useState(false)

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  useEffect(() => {
    let cancelled = false

    const bootstrapAuth = async () => {
      try {
        if (accessToken) {
          if (!user) {
            const me = await api.getMe()
            if (!cancelled) setUser(me)
          }
          return
        }

        if (!refreshToken) return

        const tokens = await api.refresh(refreshToken)
        if (cancelled) return
        setTokens(tokens.access_token, tokens.refresh_token)
        const me = await api.getMe()
        if (!cancelled) setUser(me)
      } catch {
        if (!cancelled) logout()
      } finally {
        if (!cancelled) setAuthBootstrapped(true)
      }
    }

    bootstrapAuth()
    return () => {
      cancelled = true
    }
  }, [accessToken, refreshToken, user, setTokens, setUser, logout])

  if (!authBootstrapped) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Restoring session...
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/google/callback" element={<Navigate to="/login" replace />} />
      <Route
        path="/"
        element={
          <AuthGuard>
            <AppLayout>
              {user?.visibility_scope === 'own_tasks_only' && user?.own_tasks_visibility_enabled !== false
                ? <Navigate to="/my-tasks" replace />
                : <Dashboard />}
            </AppLayout>
          </AuthGuard>
        }
      />
      <Route
        path="/my-tasks"
        element={
          <AuthGuard>
            <AppLayout>
              <MyTasks />
            </AppLayout>
          </AuthGuard>
        }
      />
      <Route
        path="/projects/:id"
        element={
          <AuthGuard>
            <AppLayout>
              <ProjectDetail />
            </AppLayout>
          </AuthGuard>
        }
      />
      <Route
        path="/roadmap"
        element={
          <AuthGuard>
            <AppLayout>
              <Roadmap />
            </AppLayout>
          </AuthGuard>
        }
      />
      <Route
        path="/analytics"
        element={
          <AuthGuard>
            <AppLayout>
              <Analytics />
            </AppLayout>
          </AuthGuard>
        }
      />
      <Route
        path="/workload"
        element={
          <AuthGuard>
            <AppLayout>
              <WorkloadCalendar />
            </AppLayout>
          </AuthGuard>
        }
      />
      <Route
        path="/team"
        element={
          <AuthGuard>
            <AppLayout>
              <Team />
            </AppLayout>
          </AuthGuard>
        }
      />
      <Route
        path="/team-board"
        element={
          <AuthGuard>
            <AppLayout>
              <TeamBoard />
            </AppLayout>
          </AuthGuard>
        }
      />
      <Route
        path="/storage"
        element={
          <AuthGuard>
            <AppLayout>
              <TeamStorage />
            </AppLayout>
          </AuthGuard>
        }
      />
      <Route
        path="/chat"
        element={
          <AuthGuard>
            <AppLayout>
              <Chat />
            </AppLayout>
          </AuthGuard>
        }
      />
      <Route
        path="/help"
        element={
          <AuthGuard>
            <AppLayout>
              <Help />
            </AppLayout>
          </AuthGuard>
        }
      />
      <Route path="/settings" element={<Navigate to="/team" replace />} />
    </Routes>
  )
}
