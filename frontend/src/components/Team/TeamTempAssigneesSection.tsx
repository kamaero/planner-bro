import { Button } from '@/components/ui/button'
import { formatUserDisplayName } from '@/lib/userName'
import type { TempAssignee, User } from '@/types'

type TeamTempAssigneesSectionProps = {
  users: User[]
  tempAssignees: TempAssignee[]
  tempAssigneesLoading: boolean
  tempAssigneesError: string
  tempAssigneeBusyId: string | null
  tempAssigneeLinkDrafts: Record<string, string>
  onReload: () => void
  onLinkDraftChange: (tempAssigneeId: string, userId: string) => void
  onLink: (item: TempAssignee) => void
  onPromote: (item: TempAssignee) => void
  onIgnore: (item: TempAssignee) => void
}

export function TeamTempAssigneesSection({
  users,
  tempAssignees,
  tempAssigneesLoading,
  tempAssigneesError,
  tempAssigneeBusyId,
  tempAssigneeLinkDrafts,
  onReload,
  onLinkDraftChange,
  onLink,
  onPromote,
  onIgnore,
}: TeamTempAssigneesSectionProps) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Temp-исполнители из файлов</h2>
        <Button variant="outline" size="sm" onClick={onReload} disabled={tempAssigneesLoading}>
          {tempAssigneesLoading ? 'Обновление...' : 'Обновить'}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Нераспознанные исполнители из импорта. Их можно связать с существующим аккаунтом или завести как нового сотрудника.
      </p>
      {tempAssigneesError && <p className="text-sm text-destructive">{tempAssigneesError}</p>}
      {!tempAssigneesLoading && tempAssignees.length === 0 && (
        <p className="text-sm text-muted-foreground">Пока нет нераспознанных исполнителей.</p>
      )}
      {!tempAssigneesLoading && tempAssignees.length > 0 && (
        <div className="space-y-2">
          {tempAssignees.map((item) => (
            <div key={item.id} className="rounded border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{item.raw_name}</span>
                <span className="text-muted-foreground">· source: {item.source}</span>
                <span className="text-muted-foreground">· seen: {item.seen_count}</span>
                {item.email && <span className="text-muted-foreground">· {item.email}</span>}
              </div>
              <div className="flex flex-col md:flex-row gap-2 md:items-center">
                <select
                  value={tempAssigneeLinkDrafts[item.id] ?? ''}
                  onChange={(e) => onLinkDraftChange(item.id, e.target.value)}
                  className="w-full md:w-80 border rounded px-2 py-2 bg-background text-sm"
                >
                  <option value="">Связать с пользователем...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {formatUserDisplayName(u)} ({u.email})
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onLink(item)}
                  disabled={!tempAssigneeLinkDrafts[item.id] || tempAssigneeBusyId === item.id}
                >
                  Связать
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onPromote(item)}
                  disabled={tempAssigneeBusyId === item.id}
                >
                  Создать пользователя
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onIgnore(item)}
                  disabled={tempAssigneeBusyId === item.id}
                >
                  Игнорировать
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
