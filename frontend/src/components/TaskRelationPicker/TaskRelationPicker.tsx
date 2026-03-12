import { useId, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { stripTaskOrderPrefix } from '@/lib/taskOrdering'
import type { Task } from '@/types'

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

type TaskRelationPickerProps = {
  tasks: Task[]
  depthById: Map<string, number>
  numberingById?: Map<string, string>
  value: string | string[]
  onChange: (next: string | string[]) => void
  multiple?: boolean
  emptyLabel: string
  placeholder?: string
  excludeIds?: string[]
  className?: string
}

export function TaskRelationPicker({
  tasks,
  depthById,
  numberingById,
  value,
  onChange,
  multiple = false,
  emptyLabel,
  placeholder = 'Поиск по задачам',
  excludeIds = [],
  className,
}: TaskRelationPickerProps) {
  const [query, setQuery] = useState('')
  const inputGroupName = useId()
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds])
  const selectedIds = multiple ? (value as string[]) : value ? [value as string] : []

  const availableTasks = useMemo(
    () => tasks.filter((task) => !excluded.has(task.id)),
    [excluded, tasks]
  )

  const filteredTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return availableTasks
    return availableTasks.filter((task) => {
      const numbering = numberingById?.get(task.id) ?? ''
      const haystack = `${numbering} ${stripTaskOrderPrefix(task.title)} ${task.title}`.toLowerCase()
      return haystack.includes(normalized)
    })
  }, [availableTasks, numberingById, query])

  const selectedTasks = useMemo(
    () => availableTasks.filter((task) => selectedIds.includes(task.id)),
    [availableTasks, selectedIds]
  )

  const toggleTask = (taskId: string) => {
    if (multiple) {
      const current = value as string[]
      if (current.includes(taskId)) {
        onChange(current.filter((id) => id !== taskId))
        return
      }
      onChange([...current, taskId])
      return
    }
    onChange(taskId === value ? '' : taskId)
  }

  const clearSelection = () => onChange(multiple ? [] : '')

  return (
    <div className={cn('rounded-lg border bg-muted/20 p-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {multiple ? 'Выбранные связи' : 'Выбранная задача'}
        </p>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={clearSelection}
            className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
          >
            Очистить
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
        {selectedTasks.length === 0 && (
          <span className="rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground">
            {emptyLabel}
          </span>
        )}
        {selectedTasks.map((task) => {
          const numbering = numberingById?.get(task.id)
          const title = stripTaskOrderPrefix(task.title)
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => toggleTask(task.id)}
              title={`${numbering ? `${numbering} ` : ''}${title}`}
              className="max-w-full rounded-full border bg-background px-2.5 py-1 text-xs transition-colors hover:bg-accent"
            >
              <span className="inline-flex max-w-full items-center gap-1">
                {numbering && <span className="shrink-0 text-muted-foreground">{numbering}</span>}
                <span className="truncate">{title}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
        {filteredTasks.length === 0 && (
          <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            По этому запросу ничего не найдено.
          </p>
        )}
        {filteredTasks.map((task) => {
          const checked = selectedIds.includes(task.id)
          const numbering = numberingById?.get(task.id)
          const title = stripTaskOrderPrefix(task.title)
          const depth = depthById.get(task.id) ?? 0
          return (
            <label
              key={task.id}
              title={`${numbering ? `${numbering} ` : ''}${title}`}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border bg-background px-3 py-2 transition-colors hover:bg-accent',
                checked && 'border-primary/40 bg-primary/5'
              )}
            >
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={multiple ? undefined : inputGroupName}
                checked={checked}
                onChange={() => toggleTask(task.id)}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1" style={{ paddingLeft: `${depth * 14}px` }}>
                <p className="truncate text-sm font-medium">
                  {numbering ? `${numbering} ` : ''}
                  {title}
                </p>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}
