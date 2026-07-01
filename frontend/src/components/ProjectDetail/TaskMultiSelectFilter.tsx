import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface MultiSelectOption {
  value: string
  label: string
}

interface Props {
  options: MultiSelectOption[]
  selected: string[]
  onChange: (values: string[]) => void
  /** Подпись, когда ничего не выбрано (значит «все»), например «Все статусы». */
  allLabel: string
  className?: string
}

/**
 * Компактный фильтр с множественным выбором (чекбокс-дропдаун).
 * Пустой `selected` трактуется как «выбраны все» — так фильтр по умолчанию
 * ничего не отсекает. Закрывается по клику вне области.
 */
export function TaskMultiSelectFilter({ options, selected, onChange, allLabel, className }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const summary =
    selected.length === 0
      ? allLabel
      : options
          .filter((o) => selected.includes(o.value))
          .map((o) => o.label)
          .join(', ')

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 border rounded px-2 py-2 text-sm bg-background text-left"
        title={summary}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[200px] max-h-72 overflow-auto rounded border bg-popover text-popover-foreground shadow-md p-1">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-2 py-1 text-xs text-muted-foreground hover:bg-accent rounded"
            >
              Сбросить
            </button>
          )}
          {options.map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
                className="h-4 w-4"
              />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
