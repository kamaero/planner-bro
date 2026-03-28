import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjects, useDepartmentDashboard } from '@/hooks/useProjects'
import type { Project } from '@/types'

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  planning: { bg: '#f1f5f9', text: '#475569', border: '#94a3b8' },
  tz:        { bg: '#ecfeff', text: '#0e7490', border: '#22d3ee' },
  active:    { bg: '#eef2ff', text: '#4338ca', border: '#818cf8' },
  testing:   { bg: '#f5f3ff', text: '#6d28d9', border: '#a78bfa' },
  on_hold:   { bg: '#fffbeb', text: '#b45309', border: '#fbbf24' },
  completed: { bg: '#ecfdf5', text: '#065f46', border: '#34d399' },
}

const STATUS_LABELS: Record<string, string> = {
  planning: 'Планирование',
  tz: 'ТЗ',
  active: 'Активный',
  testing: 'Тестирование',
  on_hold: 'На паузе',
  completed: 'Завершён',
}

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
}

const PRIORITY_COLORS: Record<string, string> = {
  low: '#94a3b8',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
}

const PX_PER_DAY: Record<string, number> = {
  week: 14,
  month: 5,
  quarter: 2,
}

const MONTHS_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

const LEFT_W = 240
const ROW_H = 44
const DEPT_ROW_H = 28
const HEADER_H = 44
const BAR_H = 26

type ZoomLevel = 'week' | 'month' | 'quarter'

interface TooltipState {
  project: Project
  mx: number
  my: number
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export function Roadmap() {
  const navigate = useNavigate()
  const { data: projects = [], isLoading } = useProjects()
  const { data: deptData } = useDepartmentDashboard()

  const [zoom, setZoom] = useState<ZoomLevel>('month')
  const [hideCompleted, setHideCompleted] = useState(false)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const pxPerDay = PX_PER_DAY[zoom]

  // --- filter ---
  const visibleProjects = useMemo(
    () => (hideCompleted ? projects.filter((p) => p.status !== 'completed') : projects),
    [projects, hideCompleted],
  )

  // --- timeline bounds ---
  const { timelineStart, timelineDays } = useMemo(() => {
    const withDates = visibleProjects.filter((p) => p.start_date || p.end_date)
    let start: Date, end: Date
    if (withDates.length === 0) {
      const now = new Date()
      start = new Date(now.getFullYear(), 0, 1)
      end = new Date(now.getFullYear(), 11, 31)
    } else {
      const allMs = withDates.flatMap((p) => [
        p.start_date ? new Date(p.start_date).getTime() : Infinity,
        p.end_date ? new Date(p.end_date).getTime() : -Infinity,
      ])
      start = new Date(Math.min(...allMs.filter((v) => v !== Infinity)))
      end = new Date(Math.max(...allMs.filter((v) => v !== -Infinity)))
    }
    // pad by 1 month on each side
    start = new Date(start.getFullYear(), start.getMonth() - 1, 1)
    end = new Date(end.getFullYear(), end.getMonth() + 2, 0)
    return { timelineStart: start, timelineDays: daysBetween(start, end) + 1 }
  }, [visibleProjects])

  const totalWidth = timelineDays * pxPerDay

  // --- group by department ---
  const groups = useMemo(() => {
    const result: Array<{ id: string; name: string; projects: Project[] }> = []
    const assignedIds = new Set<string>()

    if (deptData?.departments) {
      for (const dept of deptData.departments) {
        const filtered = dept.projects.filter((p) => visibleProjects.some((vp) => vp.id === p.id))
        if (filtered.length > 0) {
          result.push({ id: dept.department_id, name: dept.department_name, projects: filtered })
          filtered.forEach((p) => assignedIds.add(p.id))
        }
      }
    }
    const unassigned = visibleProjects.filter((p) => !assignedIds.has(p.id))
    if (unassigned.length > 0) {
      result.push({ id: '__none__', name: 'Без департамента', projects: unassigned })
    }
    return result
  }, [visibleProjects, deptData])

  // --- month header markers ---
  const monthHeaders = useMemo(() => {
    const headers: { label: string; x: number; width: number; year: number; month: number }[] = []
    let d = new Date(timelineStart.getFullYear(), timelineStart.getMonth(), 1)
    const timelineEnd = new Date(timelineStart.getTime() + timelineDays * 86_400_000)

    while (d < timelineEnd) {
      const mStart = new Date(d)
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1)
      const startOff = Math.max(0, daysBetween(timelineStart, mStart))
      const endOff = Math.min(timelineDays, daysBetween(timelineStart, mEnd))
      headers.push({
        label: `${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`,
        x: startOff * pxPerDay,
        width: (endOff - startOff) * pxPerDay,
        year: d.getFullYear(),
        month: d.getMonth(),
      })
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    }
    return headers
  }, [timelineStart, timelineDays, pxPerDay])

  // --- today marker ---
  const todayX = useMemo(() => {
    return daysBetween(timelineStart, new Date()) * pxPerDay
  }, [timelineStart, pxPerDay])

  // scroll to today on mount / zoom change
  useEffect(() => {
    if (!containerRef.current) return
    const targetScroll = LEFT_W + todayX - containerRef.current.clientWidth / 2
    containerRef.current.scrollLeft = Math.max(0, targetScroll)
  }, [todayX, zoom])

  // --- bar geometry ---
  const getBar = (project: Project) => {
    if (!project.start_date && !project.end_date) return null
    const s = new Date(project.start_date ?? project.end_date!)
    const e = new Date(project.end_date ?? project.start_date!)
    const x = daysBetween(timelineStart, s) * pxPerDay
    const rawW = daysBetween(s, e) * pxPerDay
    return { x, width: Math.max(rawW, 6) }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Загрузка...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full select-none">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-background flex-shrink-0 gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Roadmap</h1>
          <span className="text-xs text-muted-foreground">{visibleProjects.length} проектов</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              if (!containerRef.current) return
              const target = LEFT_W + todayX - containerRef.current.clientWidth / 2
              containerRef.current.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
            }}
            className="text-xs px-3 py-1.5 rounded-md border hover:bg-accent transition-colors"
          >
            Сегодня
          </button>

          {/* Zoom switcher */}
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(['week', 'month', 'quarter'] as ZoomLevel[]).map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`px-3 py-1.5 transition-colors ${
                  zoom === z ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                }`}
              >
                {z === 'week' ? 'Неделя' : z === 'month' ? 'Месяц' : 'Квартал'}
              </button>
            ))}
          </div>

          <button
            onClick={() => setHideCompleted((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
              hideCompleted ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
            }`}
          >
            {hideCompleted ? 'Показать завершённые' : 'Скрыть завершённые'}
          </button>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-b bg-muted/30 flex-shrink-0 overflow-x-auto">
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5 flex-none">
            <div
              className="w-3 h-3 rounded-sm border flex-none"
              style={{ background: STATUS_COLORS[key]?.bg, borderColor: STATUS_COLORS[key]?.border }}
            />
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* ── Timeline ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
      >
        <div style={{ width: LEFT_W + totalWidth, minHeight: '100%', position: 'relative' }}>

          {/* Today vertical line (runs full height behind content) */}
          {todayX >= 0 && todayX <= totalWidth && (
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-[5]"
              style={{ left: LEFT_W + todayX, width: 1, background: 'rgba(239,68,68,0.6)' }}
            />
          )}

          {/* ── Header row ── */}
          <div className="sticky top-0 z-20 flex" style={{ height: HEADER_H }}>
            {/* Left sticky cell */}
            <div
              className="sticky left-0 z-30 flex-none flex items-end pb-2 px-3 bg-background border-r border-b"
              style={{ width: LEFT_W }}
            >
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Проект</span>
            </div>
            {/* Month markers */}
            <div className="relative bg-background border-b" style={{ width: totalWidth, flexShrink: 0 }}>
              {monthHeaders.map((m, i) => (
                <div
                  key={i}
                  className="absolute flex items-end pb-2 border-r border-border/30"
                  style={{ left: m.x, width: m.width, height: HEADER_H }}
                >
                  {m.width > 32 && (
                    <span className="text-xs text-muted-foreground px-2 truncate">{m.label}</span>
                  )}
                </div>
              ))}
              {/* today label in header */}
              {todayX >= 0 && todayX <= totalWidth && (
                <div
                  className="absolute bottom-1 text-[10px] text-red-500 font-medium pointer-events-none"
                  style={{ left: todayX + 3 }}
                >
                  ●
                </div>
              )}
            </div>
          </div>

          {/* ── Data rows ── */}
          {groups.map((group) => (
            <div key={group.id}>
              {/* Dept header */}
              <div className="flex sticky-row" style={{ height: DEPT_ROW_H }}>
                <div
                  className="sticky left-0 z-10 flex-none flex items-center px-3 bg-muted/50 border-r border-b"
                  style={{ width: LEFT_W }}
                >
                  <span className="text-xs font-semibold text-muted-foreground truncate">{group.name}</span>
                </div>
                <div
                  className="flex-none bg-muted/20 border-b"
                  style={{ width: totalWidth }}
                >
                  {/* month grid lines */}
                  {monthHeaders.map((m, i) => (
                    <div
                      key={i}
                      className="absolute h-full border-r border-border/20 pointer-events-none"
                      style={{ left: LEFT_W + m.x }}
                    />
                  ))}
                </div>
              </div>

              {/* Project rows */}
              {group.projects.map((project) => {
                const bar = getBar(project)
                const colors = STATUS_COLORS[project.status] ?? STATUS_COLORS.planning
                return (
                  <div key={project.id} className="flex" style={{ height: ROW_H }}>
                    {/* Left sticky: project name */}
                    <div
                      className="sticky left-0 z-10 flex-none flex items-center px-3 bg-background border-r border-b hover:bg-muted/30 cursor-pointer transition-colors gap-2"
                      style={{ width: LEFT_W }}
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      <div
                        className="w-2 h-2 rounded-full flex-none"
                        style={{ background: colors.border }}
                      />
                      <span className="text-sm truncate leading-tight">{project.name}</span>
                    </div>

                    {/* Right: timeline bar */}
                    <div className="relative flex-none border-b" style={{ width: totalWidth }}>
                      {/* month grid lines */}
                      {monthHeaders.map((m, i) => (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 border-r border-border/20 pointer-events-none"
                          style={{ left: m.x }}
                        />
                      ))}

                      {bar ? (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 rounded cursor-pointer transition-opacity hover:opacity-80"
                          style={{
                            left: bar.x,
                            width: bar.width,
                            height: BAR_H,
                            background: colors.bg,
                            border: `1.5px solid ${colors.border}`,
                          }}
                          onClick={() => navigate(`/projects/${project.id}`)}
                          onMouseEnter={(e) => setTooltip({ project, mx: e.clientX, my: e.clientY })}
                          onMouseMove={(e) => setTooltip((t) => t ? { ...t, mx: e.clientX, my: e.clientY } : null)}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          {bar.width > 50 && (
                            <span
                              className="absolute inset-0 flex items-center px-2 text-xs font-medium truncate pointer-events-none"
                              style={{ color: colors.text }}
                            >
                              {project.name}
                            </span>
                          )}
                          {/* priority dot */}
                          <div
                            className="absolute -top-1 -right-1 w-2 h-2 rounded-full border border-background"
                            style={{ background: PRIORITY_COLORS[project.priority] ?? '#94a3b8' }}
                          />
                        </div>
                      ) : (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 text-xs text-muted-foreground/40 italic pointer-events-none"
                          style={{ left: Math.max(4, todayX - 2) }}
                        >
                          —
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

          {groups.length === 0 && (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Нет проектов для отображения
            </div>
          )}
        </div>
      </div>

      {/* ── Tooltip ── */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-popover border rounded-lg shadow-xl p-3 text-sm"
          style={{
            left: tooltip.mx + 14,
            top: Math.max(8, tooltip.my - 90),
            maxWidth: 260,
          }}
        >
          <div className="font-semibold mb-1.5 leading-tight">{tooltip.project.name}</div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="flex gap-2">
              <span>Статус:</span>
              <span
                className="font-medium"
                style={{ color: STATUS_COLORS[tooltip.project.status]?.border }}
              >
                {STATUS_LABELS[tooltip.project.status]}
              </span>
            </div>
            <div className="flex gap-2">
              <span>Приоритет:</span>
              <span
                className="font-medium"
                style={{ color: PRIORITY_COLORS[tooltip.project.priority] }}
              >
                {PRIORITY_LABELS[tooltip.project.priority]}
              </span>
            </div>
            {tooltip.project.start_date && (
              <div className="flex gap-2">
                <span>Начало:</span>
                <span className="text-foreground">{tooltip.project.start_date}</span>
              </div>
            )}
            {tooltip.project.end_date && (
              <div className="flex gap-2">
                <span>Конец:</span>
                <span className="text-foreground">{tooltip.project.end_date}</span>
              </div>
            )}
            {tooltip.project.description && (
              <div className="pt-1 border-t text-muted-foreground line-clamp-2 leading-relaxed">
                {tooltip.project.description}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
