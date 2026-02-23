import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useThemeStore } from '@/store/themeStore'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { ProjectDetail } from '@/pages/ProjectDetail'
import { Settings } from '@/pages/Settings'
import { Analytics } from '@/pages/Analytics'
import { GoogleCallback } from '@/pages/GoogleCallback'
import { NotificationBell } from '@/components/NotificationBell/NotificationBell'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Link, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Settings as SettingsIcon, BarChart2, Moon, Sun } from 'lucide-react'

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
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  useWebSocket()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="font-bold text-lg tracking-tight">
            planner-bro
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link
              to="/"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <LayoutDashboard className="w-4 h-4" />
              Projects
            </Link>
            <Link
              to="/analytics"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <BarChart2 className="w-4 h-4" />
              Analytics
            </Link>
            <Link
              to="/settings"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <SettingsIcon className="w-4 h-4" />
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <NotificationBell />
          <span className="text-sm text-muted-foreground">{user?.name}</span>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}

export function App() {
  const { theme } = useThemeStore()

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

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
