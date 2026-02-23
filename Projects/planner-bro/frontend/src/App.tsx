import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useThemeStore } from '@/store/themeStore'
import { api } from '@/api/client'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { ProjectDetail } from '@/pages/ProjectDetail'
import { Settings } from '@/pages/Settings'
import { Analytics } from '@/pages/Analytics'
import { GoogleCallback } from '@/pages/GoogleCallback'
import { NotificationBell } from '@/components/NotificationBell/NotificationBell'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Link, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Settings as SettingsIcon,
  BarChart2,
  Moon,
  Sun,
  LogOut,
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
  const [searchData, setSearchData] = useState<{
    projects: Array<{ id: string; name: string; status: string }>
    tasks: Array<{ id: string; title: string; project_id: string; status: string }>
    users: Array<{ id: string; name: string; email: string }>
  } | null>(null)
  useWebSocket()

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
    { to: '/', label: 'Проекты', icon: LayoutDashboard },
    { to: '/analytics', label: 'Аналитика', icon: BarChart2 },
    { to: '/settings', label: 'Настройки', icon: SettingsIcon },
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

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-64 border-r bg-card/60">
        <div className="px-6 py-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">
            PB
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">Planner Bro</div>
            <div className="text-xs text-muted-foreground mt-1">ИТ отдел</div>
          </div>
        </div>
        <nav className="px-3 space-y-1">
          {navItems.map((item) => {
            const active =
              item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto px-4 py-4 border-t flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <p className="text-xs text-muted-foreground truncate">Участник команды</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Выйти">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="border-b bg-card px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">ИТ проекты</p>
            <h1 className="text-lg font-semibold">Панель управления</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden lg:block w-96 relative">
              <Input
                placeholder="Глобальный поиск: проекты, задачи, люди"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
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
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>
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
      <Route path="/auth/google/callback" element={<GoogleCallback />} />
      <Route
        path="/"
        element={
          <AuthGuard>
            <AppLayout>
              <Dashboard />
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
        path="/settings"
        element={
          <AuthGuard>
            <AppLayout>
              <Settings />
            </AppLayout>
          </AuthGuard>
        }
      />
    </Routes>
  )
}
