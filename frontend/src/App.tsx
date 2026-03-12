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
import { NotificationBell } from '@/components/NotificationBell/NotificationBell'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  ListChecks,
  CircleHelp,
  Search,
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
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteData, setPaletteData] = useState<{
    projects: Array<{ id: string; name: string; status: string }>
    tasks: Array<{ id: string; title: string; project_id: string; status: string }>
    users: Array<{ id: string; name: string; email: string }>
  } | null>(null)
  const clientErrorFloodGuardRef = useRef<Record<string, number>>({})
  const [searchData, setSearchData] = useState<{
    projects: Array<{ id: string; name: string; status: string }>
    tasks: Array<{ id: string; title: string; project_id: string; status: string }>
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
      ? [{ to: '/my-tasks', label: 'Мои задачи', icon: ListChecks }]
      : []),
    { to: '/', label: 'Проекты', icon: LayoutDashboard },
    { to: '/analytics', label: 'Аналитика', icon: BarChart2 },
    { to: '/team', label: 'Команда', icon: Users },
    { to: '/team-board', label: 'Доска команды', icon: PencilRuler },
    { to: '/storage', label: 'Хранилище', icon: Lock },
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
    let cancelled = false
    const timer = setTimeout(async () => {
      if (!paletteOpen) return
      if (!paletteQuery.trim()) {
        setPaletteData(null)
        return
      }
      try {
        const res = await api.globalSearch(paletteQuery.trim())
        if (!cancelled) setPaletteData(res)
      } catch {
        if (!cancelled) setPaletteData(null)
      }
    }, 180)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [paletteOpen, paletteQuery])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    setPaletteOpen(false)
    setPaletteQuery('')
    setPaletteData(null)
  }, [location.pathname, location.search])

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

  const quickActions = [
    ...(user?.visibility_scope === 'own_tasks_only' && user?.own_tasks_visibility_enabled !== false
      ? [{ label: 'Мои задачи', description: 'Открыть личный список задач', to: '/my-tasks' }]
      : []),
    { label: 'Проекты', description: 'Открыть дашборд проектов', to: '/' },
    { label: 'Аналитика', description: 'Открыть аналитические срезы', to: '/analytics' },
    { label: 'Команда', description: 'Открыть команду и роли', to: '/team' },
    { label: 'Доска команды', description: 'Открыть доску команды', to: '/team-board' },
    { label: 'Хранилище', description: 'Открыть зашифрованное хранилище', to: '/storage' },
    { label: 'Общий чат', description: 'Открыть командный чат', to: '/chat' },
    { label: 'Help', description: 'Открыть встроенную справку', to: '/help' },
  ]

  const openPaletteTarget = (to: string) => {
    setPaletteOpen(false)
    setPaletteQuery('')
    setPaletteData(null)
    navigate(to)
  }

  return (
    <div className="min-h-screen bg-background flex">
      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="w-[92vw] max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              Быстрый переход
            </DialogTitle>
          </DialogHeader>
          <div className="p-4">
            <Input
              autoFocus
              placeholder="Проекты, задачи, люди, разделы…"
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
            />
            <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto">
              {!paletteQuery.trim() && (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Быстрые разделы</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {quickActions.map((item) => (
                      <button
                        key={item.to}
                        type="button"
                        onClick={() => openPaletteTarget(item.to)}
                        className="rounded-xl border bg-card px-3 py-3 text-left transition-colors hover:bg-accent"
                      >
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {paletteQuery.trim() && (
                <>
                  {paletteData?.projects?.length ? (
                    <div>
                      <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Проекты</p>
                      <div className="space-y-2">
                        {paletteData.projects.map((project) => (
                          <button
                            key={project.id}
                            type="button"
                            onClick={() => openPaletteTarget(`/projects/${project.id}`)}
                            className="w-full rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
                          >
                            <p className="text-sm font-medium">{project.name}</p>
                            <p className="text-xs text-muted-foreground">{project.status}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {paletteData?.tasks?.length ? (
                    <div>
                      <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Задачи</p>
                      <div className="space-y-2">
                        {paletteData.tasks.map((task) => (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => openPaletteTarget(`/projects/${task.project_id}?task=${task.id}`)}
                            className="w-full rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
                          >
                            <p className="text-sm font-medium">{task.title}</p>
                            <p className="text-xs text-muted-foreground">{task.status}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {paletteData?.users?.length ? (
                    <div>
                      <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Люди</p>
                      <div className="space-y-2">
                        {paletteData.users.map((member) => (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => openPaletteTarget('/team')}
                            className="w-full rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
                          >
                            <p className="text-sm font-medium">{member.name}</p>
                            <p className="text-xs text-muted-foreground">{member.email}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {paletteData &&
                    paletteData.projects.length === 0 &&
                    paletteData.tasks.length === 0 &&
                    paletteData.users.length === 0 && (
                      <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
                        Ничего не найдено. Попробуйте часть названия проекта, задачи или email.
                      </p>
                    )}
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
            <Link
              to="/help"
              className="rounded-md border border-primary/20 bg-primary/5 p-1.5 text-primary transition-colors hover:bg-primary/10 hover:text-primary"
              aria-label="Открыть справку"
              title="Справка"
            >
              <CircleHelp className="w-4 h-4" />
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <div className="px-3 pb-3">
          <div className="relative">
            <Input
              placeholder="Глобальный поиск: проекты, задачи, люди"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Быстрый переход"
            >
              ⌘K
            </button>
            {searchData && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border bg-card shadow-md p-2 space-y-2 max-h-80 overflow-auto">
                {searchData.projects.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase text-muted-foreground mb-1">Проекты</p>
                    {searchData.projects.map((p) => (
                      <Link
                        key={p.id}
                        to={`/projects/${p.id}`}
                        className="block text-sm px-2 py-1 rounded hover:bg-accent"
                        onClick={() => {
                          setSearchQuery('')
                          setSearchData(null)
                        }}
                      >
                        {p.name}
                      </Link>
                    ))}
                  </div>
                )}
                {searchData.tasks.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase text-muted-foreground mb-1">Задачи</p>
                    {searchData.tasks.map((t) => (
                      <Link
                        key={t.id}
                        to={`/projects/${t.project_id}`}
                        className="block text-sm px-2 py-1 rounded hover:bg-accent"
                        onClick={() => {
                          setSearchQuery('')
                          setSearchData(null)
                        }}
                      >
                        {t.title}
                      </Link>
                    ))}
                  </div>
                )}
                {searchData.users.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase text-muted-foreground mb-1">Люди</p>
                    {searchData.users.map((u) => (
                      <p key={u.id} className="text-sm px-2 py-1 text-muted-foreground">
                        {u.name} · {u.email}
                      </p>
                    ))}
                  </div>
                )}
                {searchData.projects.length === 0 &&
                  searchData.tasks.length === 0 &&
                  searchData.users.length === 0 && (
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
