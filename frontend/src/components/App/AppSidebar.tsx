import { Link } from 'react-router-dom'
import { NotificationBell } from '@/components/NotificationBell/NotificationBell'
import { Input } from '@/components/ui/input'
import { CircleHelp, MessageSquare } from 'lucide-react'
import { formatUserDisplayName } from '@/lib/userName'
import type { ChatUnreadSummary, User } from '@/types'

export type AppNavItem = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

export type AppSearchPayload = {
  projects: Array<{ id: string; name: string; status: string }>
  tasks: Array<{ id: string; title: string; project_id: string; status: string }>
  users: Array<{ id: string; name: string; email: string }>
}

type AppSidebarProps = {
  user?: User | null
  locationPathname: string
  navItems: AppNavItem[]
  chatUnread?: ChatUnreadSummary
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  searchData: AppSearchPayload | null
  onSelectSearchResult: () => void
  onOpenPalette: () => void
  teamList: User[]
  teamChatList: User[]
  onlineUsers: Array<{ id: string; name: string }>
  onlineUserIds: Set<string>
  unreadDirectMap: Map<string, number>
  onOpenDirectChat: (member: User) => void
  onLogout: () => void
  themeToggle: React.ReactNode
}

export function AppSidebar({
  user,
  locationPathname,
  navItems,
  chatUnread,
  searchQuery,
  onSearchQueryChange,
  searchData,
  onSelectSearchResult,
  onOpenPalette,
  teamList,
  teamChatList,
  onlineUsers,
  onlineUserIds,
  unreadDirectMap,
  onOpenDirectChat,
  onLogout,
  themeToggle,
}: AppSidebarProps) {
  return (
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
          {themeToggle}
        </div>
      </div>
      <div className="px-3 pb-3">
        <div className="relative">
          <Input
            placeholder="Глобальный поиск: проекты, задачи, люди"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
          />
          <button
            type="button"
            onClick={onOpenPalette}
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
                      onClick={onSelectSearchResult}
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
                      onClick={onSelectSearchResult}
                    >
                      {t.title}
                    </Link>
                  ))}
                </div>
              )}
              {searchData.users.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase text-muted-foreground mb-1">Люди</p>
                  {searchData.users.map((member) => (
                    <p key={member.id} className="text-sm px-2 py-1 text-muted-foreground">
                      {member.name} · {member.email}
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
            item.to === '/' ? locationPathname === '/' : locationPathname.startsWith(item.to)
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
            locationPathname.startsWith('/chat')
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
              onClick={onLogout}
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
                    onClick={() => onOpenDirectChat(member)}
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
  )
}
