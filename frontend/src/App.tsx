import { useEffect, useMemo, useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { AppSidebar, type AppNavItem, type AppSearchPayload } from '@/components/App/AppSidebar'
import {
  CommandPaletteDialog,
  type CommandPaletteQuickAction,
} from '@/components/App/CommandPaletteDialog'
import { formatUserDisplayName } from '@/lib/userName'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useClientErrorTelemetry } from '@/hooks/useClientErrorTelemetry'
import { useQuery } from '@tanstack/react-query'
import type { ChatUnreadSummary, User } from '@/types'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  BarChart2,
  PencilRuler,
  Lock,
  Moon,
  Sun,
  ListChecks,
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
  const [paletteData, setPaletteData] = useState<AppSearchPayload | null>(null)
  const [searchData, setSearchData] = useState<AppSearchPayload | null>(null)
  useWebSocket()
  useClientErrorTelemetry()

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

  const navItems: AppNavItem[] = [
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

  const quickActions: CommandPaletteQuickAction[] = [
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

  const closeSearchDropdown = () => {
    setSearchQuery('')
    setSearchData(null)
  }

  return (
    <div className="min-h-screen bg-background flex">
      <CommandPaletteDialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        data={paletteData}
        quickActions={quickActions}
        onOpenTarget={openPaletteTarget}
      />

      <AppSidebar
        user={user}
        locationPathname={location.pathname}
        navItems={navItems}
        chatUnread={chatUnread}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchData={searchData}
        onSelectSearchResult={closeSearchDropdown}
        onOpenPalette={() => setPaletteOpen(true)}
        teamList={teamList}
        teamChatList={teamChatList}
        onlineUsers={onlineUsers}
        onlineUserIds={onlineUserIds}
        unreadDirectMap={unreadDirectMap}
        onOpenDirectChat={openDirectChat}
        onLogout={handleLogout}
        themeToggle={<ThemeToggle />}
      />
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
