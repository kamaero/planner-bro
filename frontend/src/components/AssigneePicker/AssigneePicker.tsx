import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { formatUserDisplayName } from '@/lib/userName'
import type { User } from '@/types'

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

type AssigneePickerProps = {
  users: User[]
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  className?: string
}

export function AssigneePicker({
  users,
  value,
  onChange,
  placeholder = 'Поиск исполнителя',
  className,
}: AssigneePickerProps) {
  const [query, setQuery] = useState('')

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return users
    return users.filter((user) => {
      const haystack = [
        formatUserDisplayName(user),
        user.email,
        user.work_email ?? '',
        user.position_title ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalized)
    })
  }, [query, users])

  const selectedUsers = useMemo(
    () => users.filter((user) => value.includes(user.id)),
    [users, value]
  )

  const toggleUser = (userId: string) => {
    if (value.includes(userId)) {
      onChange(value.filter((id) => id !== userId))
      return
    }
    onChange([...value, userId])
  }

  const clearAll = () => onChange([])

  return (
    <div className={cn('rounded-lg border bg-muted/20 p-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Исполнители
        </p>
        {value.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
          >
            Очистить выбор
          </button>
        )}
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="mt-3 h-9"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {selectedUsers.length === 0 && (
          <span className="rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground">
            Пока никто не выбран
          </span>
        )}
        {selectedUsers.map((user) => (
          <button
            key={user.id}
            type="button"
            onClick={() => toggleUser(user.id)}
            className="rounded-full border bg-background px-2.5 py-1 text-xs transition-colors hover:bg-accent"
          >
            {formatUserDisplayName(user)}
          </button>
        ))}
      </div>

      <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
        {filteredUsers.length === 0 && (
          <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            Никого не нашли по этому запросу.
          </p>
        )}
        {filteredUsers.map((user) => {
          const checked = value.includes(user.id)
          return (
            <label
              key={user.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border bg-background px-3 py-2 transition-colors hover:bg-accent',
                checked && 'border-primary/40 bg-primary/5'
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleUser(user.id)}
                className="mt-0.5"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{formatUserDisplayName(user)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.position_title || user.role} · {user.work_email || user.email}
                </p>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}
