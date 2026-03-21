import { Button } from '@/components/ui/button'
import type { AuthLoginEvent, User } from '@/types'
import { formatUserDisplayName } from '@/lib/userName'
import { Link } from 'react-router-dom'

type SignInStatus = {
  label: string
  tone: string
}

type TeamOverviewSectionProps = {
  users: User[]
  departmentsCount: number
  departmentsById: Record<string, string>
  loading: boolean
  canManageTeam: boolean
  loginEvents: AuthLoginEvent[]
  loginEventsLoading: boolean
  loginEventsError: string
  formatDateTime: (iso?: string | null) => string
  getSignInStatus: (user: User) => SignInStatus
  getLoginEmailType: (event: AuthLoginEvent) => string
  onReloadLoginEvents: () => void
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '—'
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

export function TeamOverviewSection({
  users,
  departmentsCount,
  departmentsById,
  loading,
  canManageTeam,
  loginEvents,
  loginEventsLoading,
  loginEventsError,
  formatDateTime,
  getSignInStatus,
  getLoginEmailType,
  onReloadLoginEvents,
}: TeamOverviewSectionProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Текущая команда</h2>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted-foreground">
              Пользователей: {users.length} · Отделов: {departmentsCount}
            </p>
            <Link
              to="/help#signals"
              className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
            >
              Как читать статусы активности
            </Link>
          </div>
        </div>
        {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
        {!loading && users.length === 0 && <p className="text-sm text-muted-foreground">Активных аккаунтов пока нет.</p>}
        {!loading && users.length > 0 && (
          <div className="overflow-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Имя Фамилия</th>
                  <th className="px-3 py-2 font-medium">Отдел</th>
                  <th className="px-3 py-2 font-medium">Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {users
                  .slice()
                  .sort((a, b) =>
                    formatUserDisplayName(a).localeCompare(formatUserDisplayName(b), 'ru')
                  )
                  .map((user) => {
                    const signInStatus = getSignInStatus(user)
                    return (
                      <tr key={user.id} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium">{formatUserDisplayName(user)}</div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {departmentsById[user.department_id || ''] || 'не назначен'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          <div className="flex flex-col gap-1">
                            <span>{timeAgo(user.last_sign_in_at ?? user.last_login_at)}</span>
                            <span className="text-[10px] text-muted-foreground/70">
                              {formatDateTime(user.last_sign_in_at ?? user.last_login_at)}
                            </span>
                            <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-medium ${signInStatus.tone}`}>
                              {signInStatus.label}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManageTeam && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Журнал входов (аудит)</h2>
            <Button size="sm" variant="outline" onClick={onReloadLoginEvents}>
              Обновить
            </Button>
          </div>
          {loginEventsLoading && <p className="text-sm text-muted-foreground">Загрузка журнала входов...</p>}
          {loginEventsError && <p className="text-sm text-destructive">{loginEventsError}</p>}
          {!loginEventsLoading && !loginEventsError && loginEvents.length === 0 && (
            <p className="text-sm text-muted-foreground">Событий входа пока нет.</p>
          )}
          {!loginEventsLoading && !loginEventsError && loginEvents.length > 0 && (
            <div className="overflow-auto rounded-lg border max-h-[420px]">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left sticky top-0">
                  <tr>
                    <th className="px-3 py-2 font-medium">Когда</th>
                    <th className="px-3 py-2 font-medium">Сотрудник</th>
                    <th className="px-3 py-2 font-medium">Email входа</th>
                    <th className="px-3 py-2 font-medium">Тип email</th>
                    <th className="px-3 py-2 font-medium">Результат</th>
                    <th className="px-3 py-2 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {loginEvents.map((event) => (
                    <tr key={event.id} className="border-t">
                      <td className="px-3 py-2 text-muted-foreground">{formatDateTime(event.created_at)}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{event.user_name || 'неизвестный пользователь'}</div>
                        <div className="text-xs text-muted-foreground">{event.user_email || '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{event.email_entered}</td>
                      <td className="px-3 py-2 text-muted-foreground">{getLoginEmailType(event)}</td>
                      <td className="px-3 py-2">
                        {event.success ? (
                          <span className="text-emerald-600 font-medium">успешно</span>
                        ) : (
                          <span className="text-red-600 font-medium">
                            ошибка{event.failure_reason ? ` (${event.failure_reason})` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{event.client_ip || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
