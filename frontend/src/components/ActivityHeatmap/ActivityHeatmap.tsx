import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { ActivityHeatmapData } from '@/types'

// Mon=0 … Sun=6, show label for Mon, Wed, Fri
const DAY_LABELS = ['Пн', '', 'Ср', '', 'Пт', '', '']

const LEVEL_COLORS = [
  '#ebedf0', // 0 — empty / future placeholder
  '#9be9a8', // 1 — low
  '#40c463', // 2 — medium
  '#30a14e', // 3 — high
  '#216e39', // 4 — max
]
const FUTURE_COLOR = '#f3f4f6' // future days — lighter than empty

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

  // Full year: Jan 1 – Dec 31 2026
  const yearStart = new Date(2026, 0, 1)
  const yearEnd   = new Date(2026, 11, 31)

  // Align grid start to nearest preceding Monday
  // getDay(): 0=Sun,1=Mon,...6=Sat  →  Mon offset = (getDay()+6)%7
  const dowStart = (yearStart.getDay() + 6) % 7 // Mon=0
  const gridStart = new Date(yearStart)
  gridStart.setDate(gridStart.getDate() - dowStart)

  // Align grid end to nearest following Sunday
  const dowEnd = (yearEnd.getDay() + 6) % 7 // Mon=0
  const daysToSun = dowEnd === 6 ? 0 : 6 - dowEnd
  const gridEnd = new Date(yearEnd)
  gridEnd.setDate(gridEnd.getDate() + daysToSun)

  const weeks: Cell[][] = []
  const cursor = new Date(gridStart)

  while (cursor <= gridEnd) {
    const week: Cell[] = []
    for (let d = 0; d < 7; d++) {
      const iso = cursor.toISOString().slice(0, 10)
      const isFuture = cursor > today
      // Only count activity for 2026 days
      const inYear = cursor >= yearStart && cursor <= yearEnd
      week.push({
        date: iso,
        count: inYear ? (daysData[iso] ?? 0) : 0,
        future: isFuture,
      })
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
    const firstInYear = week.find((c) => {
      const d = new Date(c.date + 'T00:00:00')
      return d.getFullYear() === 2026
    })
    if (!firstInYear) return
    const m = new Date(firstInYear.date + 'T00:00:00').getMonth()
    if (m !== lastMonth) {
      labels.push({ label: String(m + 1), col: i })
      lastMonth = m
    }
  })
  return labels
}

const CELL_GAP        = 2
const LEFT_LABEL_W    = 30
const NUM_SEPARATORS  = 11 // month boundary borders (months 2–12), each adds 1px

export function ActivityHeatmap() {
  const [tooltip, setTooltip] = useState<{ date: string; count: number; x: number; y: number } | null>(null)
  const [cellSize, setCellSize] = useState(11)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery<ActivityHeatmapData>({
    queryKey: ['activity-heatmap'],
    queryFn: () => api.getActivityHeatmap(365),
    staleTime: 5 * 60 * 1000,
  })

  const daysData = data?.days ?? {}
  const totalEvents = data?.total_events ?? 0
  const weeks = buildWeeks(daysData)
  const monthLabels = buildMonthLabels(weeks)
  const monthStartCols = new Set(monthLabels.map((m) => m.col))

  // Dynamic cell size based on container width
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const compute = (width: number) => {
      // Total = LEFT_LABEL_W + n*(cellSize+CELL_GAP) + NUM_SEPARATORS = width
      const size = (width - LEFT_LABEL_W - weeks.length * CELL_GAP - NUM_SEPARATORS) / weeks.length
      setCellSize(Math.max(6, size))
    }
    compute(el.clientWidth)
    const ro = new ResizeObserver((entries) => compute(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [weeks.length])

  if (isLoading) {
    return <div className="h-36 rounded-lg bg-muted animate-pulse" />
  }

  const formatDate = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

  const cellStep = cellSize + CELL_GAP

  return (
    <div className="space-y-2" ref={containerRef}>
      <span className="text-sm text-muted-foreground">
        {totalEvents.toLocaleString('ru-RU')} событий в 2026 году
      </span>

      {/* Grid — fills container width */}
      <div>
        <div>

          {/* Month labels */}
          <div className="flex mb-1" style={{ marginLeft: LEFT_LABEL_W }}>
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
            {/* Day-of-week labels (Mon–Sun) */}
            <div className="flex flex-col shrink-0" style={{ gap: CELL_GAP, marginRight: CELL_GAP, width: LEFT_LABEL_W - CELL_GAP }}>
              {DAY_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="text-xs text-muted-foreground leading-none flex items-center justify-end pr-1"
                  style={{ height: cellSize }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Week columns */}
            {weeks.map((week, wi) => (
              <div
                key={wi}
                className="flex flex-col shrink-0"
                style={{
                  gap: CELL_GAP,
                  marginRight: CELL_GAP,
                  borderLeft: monthStartCols.has(wi) && wi > 0 ? '1px solid rgba(0,0,0,0.1)' : undefined,
                }}
              >
                {week.map((cell) => {
                  const inYear =
                    cell.date >= '2026-01-01' && cell.date <= '2026-12-31'
                  const bg = !inYear
                    ? 'transparent'
                    : cell.future
                    ? FUTURE_COLOR
                    : LEVEL_COLORS[getLevel(cell.count)]

                  return (
                    <div
                      key={cell.date}
                      className="rounded-sm border border-black/5 cursor-default"
                      style={{
                        width: cellSize,
                        height: cellSize,
                        backgroundColor: bg,
                        transition: 'opacity 0.1s',
                      }}
                      onMouseEnter={(e) => {
                        if (!inYear) return
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
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend — below calendar */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
        <span>Меньше</span>
        {LEVEL_COLORS.map((color, i) => (
          <div
            key={i}
            className="rounded-sm border border-black/10"
            style={{ width: cellSize, height: cellSize, backgroundColor: color }}
          />
        ))}
        <span>Больше</span>
      </div>

      {/* Tooltip */}
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
            : tooltip.date <= new Date().toISOString().slice(0, 10)
            ? `Нет активности — ${formatDate(tooltip.date)}`
            : `${formatDate(tooltip.date)}`}
        </div>
      )}
    </div>
  )
}
