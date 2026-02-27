import { useEffect, useMemo, useRef, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useThemeStore } from '@/store/themeStore'
import { api } from '@/api/client'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { ProjectDetail } from '@/pages/ProjectDetail'
import { Team } from '@/pages/Team'
import { TeamBoard } from '@/pages/TeamBoard'
import { Analytics } from '@/pages/Analytics'
import { TeamStorage } from '@/pages/TeamStorage'
import { NotificationBell } from '@/components/NotificationBell/NotificationBell'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useQuery } from '@tanstack/react-query'
import type { ChatMessage, ChatUnreadSummary, SystemActivityLog, User } from '@/types'
import { Link, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  BarChart2,
  PencilRuler,
  Lock,
  Moon,
  Sun,
  LogOut,
  Copy,
  MessageSquare,
  Paperclip,
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
  const [activityDialogOpen, setActivityDialogOpen] = useState(false)
  const [chatDialogOpen, setChatDialogOpen] = useState(false)
  const [chatMode, setChatMode] = useState<'global' | 'direct'>('global')
  const [chatPeer, setChatPeer] = useState<User | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chatFile, setChatFile] = useState<File | null>(null)
  const chatFileRef = useRef<HTMLInputElement | null>(null)
  const [chatSending, setChatSending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [smtpProbePending, setSmtpProbePending] = useState(false)
  const [smtpProbeMessage, setSmtpProbeMessage] = useState<string>('')
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
  const { data: activityFeed = [] } = useQuery<SystemActivityLog[]>({
    queryKey: ['system-activity-logs'],
    queryFn: () => api.listSystemActivityLogs({ hours: 24, limit: 2000 }),
    refetchInterval: 20_000,
  })
  const { data: globalChat = [], refetch: refetchGlobalChat } = useQuery<ChatMessage[]>({
    queryKey: ['chat', 'global'],
    queryFn: () => api.listGlobalChatMessages({ limit: 200 }),
    enabled: chatDialogOpen && chatMode === 'global',
    refetchInterval: chatDialogOpen && chatMode === 'global' ? 10_000 : false,
  })
  const { data: directChat = [], refetch: refetchDirectChat } = useQuery<ChatMessage[]>({
    queryKey: ['chat', 'direct', chatPeer?.id],
    queryFn: () => api.listDirectChatMessages(chatPeer!.id, { limit: 200 }),
    enabled: chatDialogOpen && chatMode === 'direct' && !!chatPeer?.id,
    refetchInterval: chatDialogOpen && chatMode === 'direct' && !!chatPeer?.id ? 10_000 : false,
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
  const canRunSmtpProbe = user?.role === 'admin' || user?.role === 'manager' || !!user?.can_manage_team
  const teamList = [...teamUsers]
    .filter((u) => u.is_active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const teamChatList = teamList.filter((u) => u.id !== user?.id)
  const chatMessages = useMemo(
    () => (chatMode === 'global' ? globalChat : directChat),
    [chatMode, globalChat, directChat]
  )
  const unreadDirectMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of chatUnread?.direct ?? []) map.set(item.user_id, item.unread_count)
    return map
  }, [chatUnread])

  const senderColor = (senderId: string) => {
    const palette = [
      'text-sky-800 bg-sky-50 border-sky-300',
      'text-emerald-800 bg-emerald-50 border-emerald-300',
      'text-amber-800 bg-amber-50 border-amber-300',
      'text-rose-800 bg-rose-50 border-rose-300',
      'text-violet-800 bg-violet-50 border-violet-300',
      'text-cyan-800 bg-cyan-50 border-cyan-300',
      'text-fuchsia-800 bg-fuchsia-50 border-fuchsia-300',
      'text-lime-800 bg-lime-50 border-lime-300',
      'text-indigo-800 bg-indigo-50 border-indigo-300',
      'text-orange-800 bg-orange-50 border-orange-300',
    ]
    let hash = 0
    for (let i = 0; i < senderId.length; i += 1) hash = (hash * 31 + senderId.charCodeAt(i)) >>> 0
    return palette[hash % palette.length]
  }

  const recentActivity = activityFeed.slice(0, 6)
  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))

  const headerActivity = recentActivity.slice(0, 2)
  const levelTone: Record<string, string> = {
    info: 'text-emerald-600',
    warning: 'text-amber-600',
    error: 'text-red-600',
  }
  const activityLogText = activityFeed
    .map((item) => {
      const details =
        item.details && Object.keys(item.details).length > 0
          ? ` :: ${JSON.stringify(item.details, null, 0)}`
          : ''
      return `${formatTime(item.created_at)} [${item.level}] ${item.category}/${item.source} :: ${item.message}${details}`
    })
    .join('\n────────────────────────────────────────\n')

  const renderActivityDetails = (details?: Record<string, unknown> | null) => {
    if (!details || Object.keys(details).length === 0) return ''
    try {
      return JSON.stringify(details, null, 2)
    } catch {
      return String(details)
    }
  }

  const copyActivityLog = async () => {
    if (!activityLogText.trim()) return
    try {
      await navigator.clipboard.writeText(activityLogText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore clipboard errors
    }
  }

  const runSmtpHealthcheck = async () => {
    if (!canRunSmtpProbe || smtpProbePending) return
    setSmtpProbePending(true)
    setSmtpProbeMessage('')
    try {
      const res = await api.runSmtpHealthcheck()
      setSmtpProbeMessage(res?.message || 'SMTP health-check выполнен.')
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setSmtpProbeMessage(typeof detail === 'string' ? `Ошибка: ${detail}` : 'Ошибка SMTP health-check.')
    } finally {
      setSmtpProbePending(false)
    }
  }

  const openGlobalChat = () => {
    setChatMode('global')
    setChatPeer(null)
    setChatFile(null)
    setChatDialogOpen(true)
  }

  const openDirectChat = (member: User) => {
    setChatMode('direct')
    setChatPeer(member)
    setChatFile(null)
    setChatDialogOpen(true)
  }

  const sendChatMessage = async () => {
    const body = chatInput.trim()
    if ((!body && !chatFile) || chatSending) return
    if (chatMode === 'direct' && !chatPeer?.id) return
    setChatSending(true)
    try {
      if (chatFile) {
        await api.sendChatMessageWithFile(
          chatMode === 'global'
            ? { room_type: 'global', body: body || undefined, file: chatFile }
            : { room_type: 'direct', recipient_id: chatPeer!.id, body: body || undefined, file: chatFile }
        )
      } else {
        await api.sendChatMessage(
          chatMode === 'global'
            ? { room_type: 'global', body }
            : { room_type: 'direct', recipient_id: chatPeer!.id, body }
        )
      }
      setChatInput('')
      setChatFile(null)
      if (chatFileRef.current) chatFileRef.current.value = ''
      if (chatMode === 'global') {
        await refetchGlobalChat()
      } else {
        await refetchDirectChat()
      }
    } catch {
      // ignore send error here; user can retry
    } finally {
      setChatSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-64 border-r bg-card/60 flex flex-col h-screen sticky top-0">
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
          <button
            type="button"
            onClick={openGlobalChat}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
          >
            <MessageSquare className="w-4 h-4" />
            Общий чат
            {(chatUnread?.global_unread_count ?? 0) > 0 && (
              <span className="ml-auto rounded-full bg-primary px-1.5 py-0 text-[10px] text-primary-foreground">
                {chatUnread?.global_unread_count}
              </span>
            )}
          </button>
        </nav>
        <div className="mt-4 border-t flex-1 min-h-0 flex flex-col">
          <div className="px-4 py-4 flex items-center gap-3 border-b">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-muted-foreground truncate">Участник команды</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Выйти">
              <LogOut className="w-4 h-4" />
            </Button>
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
                      <span className="truncate">{member.name}</span>
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
        <header className="border-b bg-card px-6 py-4 flex items-center gap-4">
          <div className="shrink-0">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">ИТ проекты</p>
            <h1 className="text-lg font-semibold">Панель управления</h1>
          </div>
          <div className="hidden xl:block min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setActivityDialogOpen(true)}
              className="w-full text-left rounded-md border bg-background/80 px-3 py-2 font-mono hover:bg-accent/40 transition-colors"
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Активность системы</p>
              {headerActivity.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">[idle] Нет новых событий</p>
              ) : (
                <div className="space-y-1">
                  {headerActivity.map((item) => (
                    <p key={item.id} className="text-[11px] leading-snug truncate">
                      <span className="text-muted-foreground">{formatTime(item.created_at)}</span>
                      {'  '}
                      <span className={levelTone[item.level] ?? 'text-muted-foreground'}>[{item.level}]</span>
                      {'  '}
                      <span className="text-muted-foreground">{item.category}/{item.source}</span>
                      {' :: '}
                      <span className="text-muted-foreground">{item.message}</span>
                    </p>
                  ))}
                </div>
              )}
            </button>
          </div>
          <div className="flex items-center gap-3 ml-auto">
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
        <Dialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Активность системы (последние 24 часа)</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Событий: {activityFeed.length}
                </p>
                <div className="flex items-center gap-2">
                  {canRunSmtpProbe && (
                    <Button type="button" variant="outline" size="sm" onClick={runSmtpHealthcheck} disabled={smtpProbePending}>
                      {smtpProbePending ? 'Проверка SMTP...' : 'Проверить SMTP'}
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={copyActivityLog}>
                    <Copy className="w-4 h-4 mr-1" />
                    {copied ? 'Скопировано' : 'Скопировать лог'}
                  </Button>
                </div>
              </div>
              {smtpProbeMessage && (
                <p className="text-xs text-muted-foreground">{smtpProbeMessage}</p>
              )}
              <div className="max-h-[60vh] space-y-2 overflow-auto rounded-md border bg-background p-2">
                {activityFeed.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">[idle] Нет системных событий за последние 24 часа</p>
                ) : (
                  activityFeed.map((item) => (
                    <div key={item.id} className="rounded-md border bg-card px-3 py-2">
                      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                        <span className="text-muted-foreground">{formatTime(item.created_at)}</span>
                        <span className={levelTone[item.level] ?? 'text-muted-foreground'}>[{item.level}]</span>
                        <span className="text-muted-foreground">{item.category}/{item.source}</span>
                      </div>
                      <p className="text-xs leading-relaxed">{item.message}</p>
                      {item.details && Object.keys(item.details).length > 0 && (
                        <pre className="mt-2 overflow-auto rounded border bg-muted/30 px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                          {renderActivityDetails(item.details)}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={chatDialogOpen} onOpenChange={setChatDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {chatMode === 'global' ? 'Общий чат команды' : `Личный чат: ${chatPeer?.name ?? '—'}`}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="max-h-[52vh] min-h-[40vh] overflow-auto rounded border bg-background p-3">
                {chatMessages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Сообщений пока нет.</p>
                ) : (
                  <div className="space-y-2">
                    {chatMessages.map((msg) => {
                      const mine = msg.sender_id === user?.id
                      const tone = senderColor(msg.sender_id)
                      return (
                        <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded border px-2 py-1.5 text-sm ${tone} ${mine ? 'ring-1 ring-primary/40' : ''}`}>
                            {chatMode === 'global' && (
                              <p className="mb-1 text-[10px] text-muted-foreground">
                                {msg.sender_name} · {formatTime(msg.created_at)}
                              </p>
                            )}
                            <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                            {!!msg.attachments?.length && (
                              <div className="mt-1 space-y-1">
                                {msg.attachments.map((att) => (
                                  <a
                                    key={att.id}
                                    href={att.download_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block text-[11px] underline text-foreground"
                                  >
                                    📎 {att.filename}
                                  </a>
                                ))}
                              </div>
                            )}
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {formatTime(msg.created_at)}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="flex items-end gap-2">
                <Input
                  placeholder={chatMode === 'global' ? 'Написать в общий чат...' : `Сообщение для ${chatPeer?.name ?? 'коллеги'}...`}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void sendChatMessage()
                    }
                  }}
                />
                <input
                  ref={chatFileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setChatFile(e.target.files?.[0] ?? null)}
                />
                <Button type="button" variant="outline" onClick={() => chatFileRef.current?.click()}>
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button onClick={() => void sendChatMessage()} disabled={chatSending || (!chatInput.trim() && !chatFile)}>
                  <MessageSquare className="mr-1 h-4 w-4" />
                  Отправить
                </Button>
              </div>
              {chatFile && (
                <p className="text-xs text-muted-foreground">Вложение: {chatFile.name}</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
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
      <Route path="/settings" element={<Navigate to="/team" replace />} />
    </Routes>
  )
}
