import type { AuthLoginEvent, Department, User } from '@/types'
import { formatUserDisplayName } from '@/lib/userName'
import { Button } from '@/components/ui/button'

interface Props {
  users: User[]
  departments: Department[]
  loading: boolean
  canManageTeam: boolean | undefined
  departmentsById: Record<string, string>
  loginEvents: AuthLoginEvent[]
  loginEventsLoading: boolean
  loginEventsError: string
  loadLoginEvents: () => void
  formatDateTime: (iso?: string | null) => string
  getLoginEmailType: (event: AuthLoginEvent) => string
}

export function TeamOverviewSection({
  users,
  departments,
  loading,
  canManageTeam,
  departmentsById,
  loginEvents,
  loginEventsLoading,
  loginEventsError,
  loadLoginEvents,
  formatDateTime,
  getLoginEmailType,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Текущая команда</h2>
          <p className="text-xs text-muted-foreground">
            Пользователей: {users.length} · Отделов: {departments.length}
          </p>
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
                  .map((user) => (
                    <tr key={user.id} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-medium">{formatUserDisplayName(user)}</div>
                        <div className="text-xs text-muted-foreground">{user.email}</div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {departmentsById[user.department_id || ''] || 'не назначен'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDateTime(user.last_sign_in_at ?? user.last_login_at)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManageTeam && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Журнал входов (аудит)</h2>
            <Button size="sm" variant="outline" onClick={() => void loadLoginEvents()}>
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
