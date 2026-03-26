import { useState, useMemo } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'

interface Task {
  id: string
  title: string
}

interface TaskComboboxProps {
  value: string
  onChange: (value: string) => void
  tasks: Task[]
  depthById: Map<string, number>
  numbering: Map<string, string>
  placeholder: string
  emptyLabel?: string
}

function formatLabel(id: string, title: string, depthById: Map<string, number>, numbering: Map<string, string>) {
  const depth = depthById.get(id) ?? 0
  const num = numbering.get(id) ?? ''
  const indent = '\u00a0\u00a0'.repeat(Math.min(depth, 6))
  const label = title.length > 60 ? title.slice(0, 59) + '\u2026' : title
  return `${indent}${num ? num + '\u00a0' : ''}${label}`
}

export function TaskCombobox({
  value,
  onChange,
  tasks,
  depthById,
  numbering,
  placeholder,
  emptyLabel = 'Без родителя',
}: TaskComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selectedTask = tasks.find((t) => t.id === value)

  const filtered = useMemo(() => {
    if (!search.trim()) return tasks
    const q = search.toLowerCase()
    return tasks.filter((t) => {
      const num = numbering.get(t.id) ?? ''
      return t.title.toLowerCase().includes(q) || num.toLowerCase().includes(q)
    })
  }, [tasks, search, numbering])

  const triggerLabel = selectedTask
    ? formatLabel(selectedTask.id, selectedTask.title, depthById, numbering)
    : emptyLabel

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex-1 min-w-0 text-sm border rounded px-2 py-1 bg-background text-left flex items-center justify-between gap-1 hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring truncate"
        >
          <span className="truncate text-xs">{triggerLabel}</span>
          <svg className="shrink-0 opacity-50" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="z-[9999] bg-background border rounded-md shadow-lg overflow-hidden"
          style={{ width: 'min(560px, 90vw)' }}
          sideOffset={4}
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <div className="border-b px-2 py-1.5 flex items-center gap-1">
              <svg className="shrink-0 opacity-40" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Поиск задачи..."
                className="flex-1 text-sm outline-none bg-transparent"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="text-xs opacity-40 hover:opacity-70">✕</button>
              )}
            </div>
            <Command.List className="max-h-[280px] overflow-y-auto py-1">
              <Command.Empty className="px-3 py-2 text-sm text-muted-foreground">Не найдено</Command.Empty>

              <Command.Item
                value="__empty__"
                onSelect={() => { onChange(''); setOpen(false); setSearch('') }}
                className="px-3 py-1.5 text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent text-muted-foreground italic"
              >
                {emptyLabel}
              </Command.Item>

              {filtered.map((t) => (
                <Command.Item
                  key={t.id}
                  value={t.id}
                  onSelect={() => { onChange(t.id); setOpen(false); setSearch('') }}
                  className="px-3 py-1.5 text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent whitespace-nowrap"
                >
                  <span className="font-mono text-xs">{formatLabel(t.id, t.title, depthById, numbering)}</span>
                  {t.id === value && (
                    <svg className="ml-2 inline shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5"/></svg>
                  )}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
