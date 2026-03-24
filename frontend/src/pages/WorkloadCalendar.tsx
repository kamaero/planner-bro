/**
 * WorkloadCalendar — team workload heatmap by day.
 * Rows = team members (grouped by department), columns = days.
 * Cell colour scales from green → yellow → red by % of daily capacity used.
 */
import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkload, type WorkloadUser, type WorkloadDay } from '@/hooks/useProjects'

// ── helpers ────────────────────────────────────────────────────────────────

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function startOfWeek(d: Date): Date {
  const r = new Date(d)
  const day = r.getDay() // 0=Sun
  r.setDate(r.getDate() - ((day + 6) % 7)) // Mon-based
  return r
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
]

function dayLabel(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00')
  return String(d.getDate())
}

function weekdayIndex(isoDate: string): number {
  const d = new Date(isoDate + 'T00:00:00')
  return (d.getDay() + 6) % 7 // 0=Mon … 6=Sun
}

function isWeekend(isoDate: string): boolean {
  return weekdayIndex(isoDate) >= 5
}

function cellColor(hours: number, capacity: number): string {
  if (hours === 0) return 'bg-muted/20'
  const pct = hours / capacity
  if (pct <= 0.5) return 'bg-green-200 dark:bg-green-900/50'
  if (pct <= 0.8) return 'bg-green-300 dark:bg-green-700/60'
  if (pct <= 1.0) return 'bg-yellow-300 dark:bg-yellow-700/60'
  if (pct <= 1.25) return 'bg-orange-300 dark:bg-orange-700/60'
  return 'bg-red-400 dark:bg-red-700/70'
}

function pctText(hours: number, capacity: number): string {
  return `${Math.round((hours / capacity) * 100)}%`
}

const STATUS_RU: Record<string, string> = {
  planning: 'Планирование', tz: 'ТЗ', todo: 'К работе',
  in_progress: 'В работе', testing: 'Тест', review: 'Ревью', done: 'Готово',
}
const PRIORITY_RU: Record<string, string> = {
  low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критичный',
}

// ── Tooltip ────────────────────────────────────────────────────────────────

function DayTooltip({ day, isoDate, capacity }: { day: WorkloadDay; isoDate: string; capacity: number }) {
  const d = new Date(isoDate + 'T00:00:00')
  const title = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}, ${WEEKDAY_SHORT[weekdayIndex(isoDate)]}`
  return (
    <div className="absolute z-50 left-0 top-full mt-1 w-64 rounded-lg border bg-popover text-popover-foreground shadow-lg p-3 text-xs space-y-1.5 pointer-events-none">
      <p className="font-semibold text-sm">{title}</p>
      <p className="text-muted-foreground">
        {day.hours.toFixed(1)}ч из {capacity}ч ({pctText(day.hours, capacity)})
      </p>
      {day.tasks.length > 0 && (
        <ul className="space-y-1 mt-1">
          {day.tasks.map((t) => (
            <li key={t.id} className="flex flex-col gap-0.5 border-t pt-1 first:border-t-0 first:pt-0">
              <span className="font-medium leading-tight">{t.title}</span>
              <span className="text-muted-foreground">{t.project_name}</span>
              <span className="text-muted-foreground">
                {PRIORITY_RU[t.priority] ?? t.priority} · {STATUS_RU[t.status] ?? t.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Cell ───────────────────────────────────────────────────────────────────

function WorkloadCell({ day, isoDate, capacity }: { day: WorkloadDay | undefined; isoDate: string; capacity: number }) {
  const [hovered, setHovered] = useState(false)
  const weekend = isWeekend(isoDate)

  if (!day || day.hours === 0) {
    return (
      <td
        className={`border-r border-b border-border/30 w-8 h-8 min-w-[2rem] ${weekend ? 'bg-muted/10' : ''}`}
      />
    )
  }

  return (
    <td
      className={`border-r border-b border-border/30 w-8 h-8 min-w-[2rem] relative cursor-default`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={`w-full h-full flex items-center justify-center text-[10px] font-medium rounded-sm ${cellColor(day.hours, capacity)}`}
      >
        {day.tasks.length > 1 ? day.tasks.length : ''}
      </div>
      {hovered && <DayTooltip day={day} isoDate={isoDate} capacity={capacity} />}
    </td>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

type ViewMode = 'week' | 'month'

export function WorkloadCalendar() {
  const today = new Date()
  const [mode, setMode] = useState<ViewMode>('week')
  const [anchor, setAnchor] = useState<Date>(today)
  const [deptFilter, setDeptFilter] = useState<string>('')

  // Compute date range based on mode + anchor
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (mode === 'week') {
      const s = startOfWeek(anchor)
      return { rangeStart: s, rangeEnd: addDays(s, 6) }
    } else {
      const s = startOfMonth(anchor)
      return { rangeStart: s, rangeEnd: endOfMonth(anchor) }
    }
  }, [mode, anchor])

  const startISO = toISO(rangeStart)
  const endISO = toISO(rangeEnd)

  const { data, isLoading } = useWorkload(startISO, endISO, deptFilter || undefined)

  // Navigate
  const navigate = (dir: -1 | 1) => {
    if (mode === 'week') {
      setAnchor((a) => addDays(a, dir * 7))
    } else {
      setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1))
    }
  }

  const rangeLabel = mode === 'week'
    ? `${rangeStart.getDate()} ${MONTH_NAMES[rangeStart.getMonth()]} — ${rangeEnd.getDate()} ${MONTH_NAMES[rangeEnd.getMonth()]} ${rangeEnd.getFullYear()}`
    : `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`

  const dates = data?.dates ?? []
  const capacity = data?.daily_capacity ?? 8

  // Group users by department
  const grouped = useMemo(() => {
    if (!data) return []
    const map = new Map<string, { deptName: string; users: WorkloadUser[] }>()
    for (const u of data.users) {
      const key = u.department_id ?? '__none__'
      const name = u.department_name ?? 'Без отдела'
      if (!map.has(key)) map.set(key, { deptName: name, users: [] })
      map.get(key)!.users.push(u)
    }
    return Array.from(map.entries()).map(([, v]) => v)
  }, [data])

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-semibold">Календарь загрузки</h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Department filter */}
          {data?.departments && data.departments.length > 0 && (
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="h-8 text-sm border rounded px-2 bg-background"
            >
              <option value="">Все отделы</option>
              {data.departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}

          {/* View mode */}
          <div className="flex rounded-md border overflow-hidden text-sm">
            <button
              onClick={() => setMode('week')}
              className={`px-3 py-1 ${mode === 'week' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'}`}
            >
              Неделя
            </button>
            <button
              onClick={() => setMode('month')}
              className={`px-3 py-1 ${mode === 'month' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'}`}
            >
              Месяц
            </button>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => navigate(-1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium min-w-52 text-center">{rangeLabel}</span>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => navigate(1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="outline" size="sm" className="h-8 text-xs px-2"
              onClick={() => setAnchor(today)}
            >
              Сегодня
            </Button>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span>Загрузка:</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-200 dark:bg-green-900/50" /> ≤50%</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-300 dark:bg-green-700/60" /> 51–80%</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-yellow-300 dark:bg-yellow-700/60" /> 81–100%</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-orange-300 dark:bg-orange-700/60" /> 101–125%</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-400 dark:bg-red-700/70" /> &gt;125%</span>
        <span className="ml-2">Базовая ёмкость: {capacity}ч/день</span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Загрузка...</div>
      ) : dates.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Нет данных</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="border-collapse text-xs min-w-full">
            <thead>
              {/* Day numbers row */}
              <tr>
                <th className="sticky left-0 z-10 bg-card border-r border-b border-border/50 text-left px-3 py-2 text-muted-foreground font-normal min-w-40">
                  Сотрудник
                </th>
                {dates.map((d) => (
                  <th
                    key={d}
                    className={`border-r border-b border-border/50 text-center py-1 w-8 min-w-[2rem] font-medium ${
                      d === toISO(today) ? 'text-primary' : isWeekend(d) ? 'text-muted-foreground/50' : ''
                    }`}
                  >
                    {dayLabel(d)}
                  </th>
                ))}
              </tr>
              {/* Weekday labels row (week mode only) */}
              {mode === 'week' && (
                <tr>
                  <th className="sticky left-0 z-10 bg-card border-r border-b border-border/50" />
                  {dates.map((d) => (
                    <th
                      key={d}
                      className={`border-r border-b border-border/50 text-center py-0.5 w-8 min-w-[2rem] font-normal text-muted-foreground ${
                        isWeekend(d) ? 'opacity-40' : ''
                      }`}
                    >
                      {WEEKDAY_SHORT[weekdayIndex(d)]}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {grouped.map((group, gi) => (
                <>
                  {/* Department header row */}
                  <tr key={`dept-${gi}`} className="bg-muted/40">
                    <td
                      colSpan={dates.length + 1}
                      className="sticky left-0 px-3 py-1 text-xs font-semibold text-muted-foreground border-b border-border/50"
                    >
                      {group.deptName}
                    </td>
                  </tr>
                  {/* User rows */}
                  {group.users.map((u) => (
                    <tr key={u.id} className="hover:bg-accent/20 transition-colors">
                      <td className="sticky left-0 z-10 bg-card border-r border-b border-border/30 px-3 py-1.5 font-medium whitespace-nowrap min-w-40">
                        {u.name}
                      </td>
                      {dates.map((d) => (
                        <WorkloadCell key={d} day={u.days[d]} isoDate={d} capacity={capacity} />
                      ))}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
