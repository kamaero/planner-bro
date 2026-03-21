import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { ActivityHeatmapData } from '@/types'

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const DAY_LABELS = ['', 'Пн', '', 'Ср', '', 'Пт', '']

// 5 levels: 0 = no activity, 1–4 = intensity
const LEVEL_COLORS = [
  '#ebedf0', // 0 — empty
  '#9be9a8', // 1 — low
  '#40c463', // 2 — medium
  '#30a14e', // 3 — high
  '#216e39', // 4 — max
]

function getLevel(count: number): number {
  if (count === 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 10) return 3
  return 4
}

type Cell = { date: string; count: number; future: boolean }

function buildWeeks(daysData: Record<string, number>): Cell[][] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Start 52 full weeks back, aligned to Sunday
  const start = new Date(today)
  start.setDate(today.getDate() - 52 * 7)
  start.setDate(start.getDate() - start.getDay())

  const weeks: Cell[][] = []
  const cursor = new Date(start)

  while (cursor <= today) {
    const week: Cell[] = []
    for (let d = 0; d < 7; d++) {
      const iso = cursor.toISOString().slice(0, 10)
      week.push({ date: iso, count: daysData[iso] ?? 0, future: cursor > today })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }

  return weeks
}

function buildMonthLabels(weeks: Cell[][]): Array<{ label: string; col: number }> {
  const labels: Array<{ label: string; col: number }> = []
  let lastMonth = -1
  weeks.forEach((week, i) => {
    const m = new Date(week[0].date + 'T00:00:00').getMonth()
    if (m !== lastMonth) {
      labels.push({ label: MONTHS[m], col: i })
      lastMonth = m
    }
  })
  return labels
}

const CELL_SIZE = 12
const CELL_GAP = 2

export function ActivityHeatmap() {
  const [tooltip, setTooltip] = useState<{ date: string; count: number; x: number; y: number } | null>(null)

  const { data, isLoading } = useQuery<ActivityHeatmapData>({
    queryKey: ['activity-heatmap'],
    queryFn: () => api.getActivityHeatmap(),
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return <div className="h-36 rounded-lg bg-muted animate-pulse" />
  }

  const daysData = data?.days ?? {}
  const totalEvents = data?.total_events ?? 0
  const weeks = buildWeeks(daysData)
  const monthLabels = buildMonthLabels(weeks)

  const formatDate = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

  const cellStep = CELL_SIZE + CELL_GAP

  return (
    <div className="space-y-3">
      {/* Legend row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-muted-foreground">
          {totalEvents.toLocaleString('ru-RU')} событий за последний год
        </span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Меньше</span>
          {LEVEL_COLORS.map((color, i) => (
            <div
              key={i}
              className="rounded-sm border border-black/10"
              style={{ width: CELL_SIZE, height: CELL_SIZE, backgroundColor: color }}
            />
          ))}
          <span>Больше</span>
        </div>
      </div>

      {/* Scrollable grid */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: weeks.length * cellStep + 28 }}>
          {/* Month labels */}
          <div className="flex mb-1" style={{ marginLeft: 28 }}>
            {weeks.map((week, i) => {
              const label = monthLabels.find((m) => m.col === i)
              return (
                <div
                  key={i}
                  className="shrink-0 text-xs text-muted-foreground leading-none overflow-hidden"
                  style={{ width: cellStep }}
                >
                  {label?.label ?? ''}
                </div>
              )
            })}
          </div>

          {/* Day labels + cell columns */}
          <div className="flex">
            {/* Day of week labels */}
            <div className="flex flex-col shrink-0" style={{ gap: CELL_GAP, marginRight: CELL_GAP, width: 24 }}>
              {DAY_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="text-xs text-muted-foreground leading-none flex items-center justify-end pr-1"
                  style={{ height: CELL_SIZE }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Week columns */}
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col shrink-0" style={{ gap: CELL_GAP, marginRight: CELL_GAP }}>
                {week.map((cell) => (
                  <div
                    key={cell.date}
                    className="rounded-sm border border-black/5 transition-opacity hover:opacity-70 cursor-default"
                    style={{
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      backgroundColor: cell.future ? 'transparent' : LEVEL_COLORS[getLevel(cell.count)],
                    }}
                    onMouseEnter={(e) => {
                      if (cell.future) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      setTooltip({
                        date: cell.date,
                        count: cell.count,
                        x: rect.left + rect.width / 2,
                        y: rect.top,
                      })
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tooltip (fixed position) */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-popover border text-popover-foreground text-xs rounded-md px-2 py-1.5 shadow-md whitespace-nowrap"
          style={{
            left: tooltip.x,
            top: tooltip.y - 6,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {tooltip.count > 0
            ? `${tooltip.count} событий — ${formatDate(tooltip.date)}`
            : `Нет активности — ${formatDate(tooltip.date)}`}
        </div>
      )}
    </div>
  )
}
