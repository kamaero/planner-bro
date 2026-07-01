import { useMemo, useState } from 'react'
import { useStatusSnapshotReport } from '@/hooks/useReports'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Clipboard, Download, FileJson, FileText, Presentation, Printer, RefreshCw } from 'lucide-react'
import type { ReportKpi, ReportProjectSummary, ReportSlide, StatusSnapshotReport } from '@/types'

function defaultFromDate() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('ru-RU')
  }
  return new Date(value).toLocaleDateString('ru-RU')
}

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('ru-RU')
}

function filenamePeriod(report: StatusSnapshotReport) {
  return `${report.period.from_date}_${report.period.to_date}`
}

function downloadBlob(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function kpiTone(kpi: ReportKpi) {
  if (kpi.severity === 'danger') return 'border-red-200 bg-red-50 text-red-950 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100'
  if (kpi.severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100'
  if (kpi.severity === 'good') return 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100'
  return 'border-border bg-card text-card-foreground'
}

function riskBadge(level: string) {
  if (level === 'high') return <Badge variant="destructive">Высокий</Badge>
  if (level === 'medium') return <Badge variant="secondary">Средний</Badge>
  return <Badge variant="outline">Низкий</Badge>
}

function downloadJson(filename: string, payload: unknown) {
  downloadBlob(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8')
}

function exportProjectCsv(report: StatusSnapshotReport) {
  const rows = [
    ['Проект', 'Слой', 'Видимость', 'Статус', 'Ответственный', 'Отделы', 'Задач', 'Выполнено', 'Прогресс', 'Просрочено', 'Критические/СКИ', 'Риск', 'Дедлайн'],
    ...report.projects.map((project) => [
      project.name,
      project.report_track,
      project.report_visibility,
      project.status_label,
      project.owner_name,
      project.department_names.join('; '),
      String(project.total_tasks),
      String(project.done_tasks),
      `${project.progress_percent}%`,
      String(project.overdue_tasks),
      String(project.critical_tasks),
      project.risk_level,
      project.end_date ?? '',
    ]),
  ]
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
  downloadBlob(`plannerbro-status-${filenamePeriod(report)}.csv`, csv, 'text/csv;charset=utf-8;')
}

function kpiValue(report: StatusSnapshotReport, id: string) {
  const item = report.kpis.find((kpi) => kpi.id === id)
  if (!item) return '0'
  return `${item.value}${item.unit ?? ''}`
}

function kpiLine(kpi: ReportKpi) {
  return `${kpi.label}: ${kpi.value}${kpi.unit ?? ''}${kpi.detail ? ` (${kpi.detail})` : ''}`
}

function projectRiskText(project: ReportProjectSummary) {
  return project.risk_reasons.length > 0 ? project.risk_reasons.join('; ') : 'рисков не выявлено'
}

function focusProjects(report: StatusSnapshotReport) {
  return [...report.projects]
    .filter((project) => project.report_track === 'main')
    .sort((a, b) => {
      const riskWeight = (risk: string) => (risk === 'high' ? 0 : risk === 'medium' ? 1 : 2)
      return (
        riskWeight(a.risk_level) - riskWeight(b.risk_level) ||
        (a.end_date ?? '9999-12-31').localeCompare(b.end_date ?? '9999-12-31') ||
        a.name.localeCompare(b.name, 'ru')
      )
    })
    .slice(0, 8)
}

function trackProjects(report: StatusSnapshotReport, track: string, limit: number) {
  const riskWeight = (risk: string) => (risk === 'high' ? 0 : risk === 'medium' ? 1 : 2)
  return [...report.projects]
    .filter((project) => project.report_track === track)
    .sort((a, b) => (
      riskWeight(a.risk_level) - riskWeight(b.risk_level) ||
      (a.end_date ?? '9999-12-31').localeCompare(b.end_date ?? '9999-12-31') ||
      a.name.localeCompare(b.name, 'ru')
    ))
    .slice(0, limit)
}

function decisionBullets(report: StatusSnapshotReport) {
  const bullets: string[] = []
  if (Number(kpiValue(report, 'overdue_projects').replace('%', '')) > 0) {
    bullets.push('Утвердить решения по просроченным проектам: перенос срока, изменение объема или эскалация.')
  }
  if (Number(kpiValue(report, 'overdue_tasks').replace('%', '')) > 0) {
    bullets.push('Разобрать просроченные задачи с ответственными и зафиксировать новые контрольные даты.')
  }
  if (Number(kpiValue(report, 'unassigned_tasks').replace('%', '')) > 0) {
    bullets.push('Назначить владельцев на задачи без ответственного.')
  }
  if (Number(kpiValue(report, 'critical_tasks').replace('%', '')) > 0) {
    bullets.push('Проверить критические/СКИ задачи и подтвердить план закрытия.')
  }
  return bullets.length > 0 ? bullets : ['Подтвердить текущий план и продолжить мониторинг без управленческих решений.']
}

function buildReportDeck(report: StatusSnapshotReport): ReportSlide[] {
  const topRisks = report.risks.slice(0, 6)
  const projects = focusProjects(report).slice(0, 7)
  const competenceProjects = trackProjects(report, 'competence_centers', 4)
  const initiativeProjects = trackProjects(report, 'initiatives', 4)
  const activeDays = report.activity_days.filter((item) => item.count > 0).length

  return [
    {
      title: 'Текущий статус ИТ проектов',
      bullets: [
        `Период: ${formatDate(report.period.from_date)} - ${formatDate(report.period.to_date)}`,
        `Контур: ${report.scope_label}`,
        `Сформировано: ${formatDateTime(report.generated_at)}`,
      ],
    },
    {
      title: 'Обзорная инфографика',
      bullets: [
        `Проектов в scope: ${kpiValue(report, 'projects_total')}`,
        `Всего задач в scope: ${kpiValue(report, 'tasks_total')}`,
        `Выполнено задач: ${kpiValue(report, 'completed_tasks')}`,
        `Просрочено задач: ${kpiValue(report, 'overdue_tasks')}`,
        `Средний прогресс: ${kpiValue(report, 'avg_progress')}`,
        `Активных дней за период: ${activeDays}; событий: ${report.activity.task_events}`,
      ],
      chart: 'overview_infographic',
    },
    {
      title: 'Крупные проекты',
      bullets: projects.length
        ? projects.map(
            (project) =>
              `${project.name}: ${project.status_label}, ${project.progress_percent}%, ответственный ${project.owner_name}, ${projectRiskText(project)}`
          )
        : ['Нет проектов в фокусе'],
      chart: 'project_table',
    },
    {
      title: 'ЦК / аутсорсинг',
      bullets: competenceProjects.length
        ? competenceProjects.map(
            (project) =>
              `${project.name}: задач ${project.done_tasks}/${project.total_tasks}, просрочено ${project.overdue_tasks}, критические/СКИ ${project.critical_tasks}`
          )
        : ['Нет ЦК в докладовом контуре'],
      chart: 'project_table',
    },
    {
      title: 'Риски и блокеры',
      bullets: topRisks.length
        ? topRisks.map((item) => `${item.title}: ${item.reason}${item.assignee_name ? `, ответственный ${item.assignee_name}` : ''}`)
        : ['Критических рисков не найдено'],
      chart: 'risk_table',
    },
    {
      title: 'Инициативы',
      bullets: initiativeProjects.length
        ? initiativeProjects.map((project) => `${project.name}: задач ${project.done_tasks}/${project.total_tasks}, ${project.progress_percent}%`)
        : ['Нет инициатив в докладовом контуре'],
      chart: 'project_table',
    },
    {
      title: 'Что требует решения',
      bullets: decisionBullets(report),
    },
  ]
}

function buildReportMarkdown(report: StatusSnapshotReport) {
  const deck = buildReportDeck(report)
  const rows = report.projects.map(
    (project) =>
      `| ${escapeMarkdown(project.name)} | ${escapeMarkdown(project.status_label)} | ${escapeMarkdown(project.owner_name)} | ${project.done_tasks}/${project.total_tasks} (${project.progress_percent}%) | ${escapeMarkdown(projectRiskText(project))} | ${formatDate(project.end_date)} |`
  )

  return [
    '# Текущий статус ИТ проектов',
    '',
    `Период: ${formatDate(report.period.from_date)} - ${formatDate(report.period.to_date)}`,
    `Контур: ${report.scope_label}`,
    `Сформировано: ${formatDateTime(report.generated_at)}`,
    '',
    '## Слайды доклада',
    '',
    ...deck.flatMap((slide, index) => [
      `### ${index + 1}. ${slide.title}`,
      '',
      ...slide.bullets.map((bullet) => `- ${bullet}`),
      '',
    ]),
    '## KPI',
    '',
    ...report.kpis.map((kpi) => `- ${kpiLine(kpi)}`),
    '',
    '## Приложение: проекты',
    '',
    '| Проект | Статус | Ответственный | Прогресс | Риски | Дедлайн |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(rows.length ? rows : ['| Нет данных | - | - | - | - | - |']),
    '',
  ].join('\n')
}

function escapeMarkdown(value: string) {
  return value.replace(/\|/g, '\\|')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildReportHtml(report: StatusSnapshotReport) {
  const deck = buildReportDeck(report)
  const projectRows = report.projects
    .map(
      (project) => `
        <tr>
          <td>${escapeHtml(project.name)}</td>
          <td>${escapeHtml(project.status_label)}</td>
          <td>${escapeHtml(project.owner_name)}</td>
          <td>${project.done_tasks}/${project.total_tasks} (${project.progress_percent}%)</td>
          <td>${escapeHtml(projectRiskText(project))}</td>
          <td>${formatDate(project.end_date)}</td>
        </tr>`
    )
    .join('')

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Текущий статус ИТ проектов</title>
  <style>
    body { margin: 32px; color: #111827; font-family: Arial, sans-serif; line-height: 1.45; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    h2 { margin-top: 28px; font-size: 20px; page-break-after: avoid; }
    h3 { margin: 0 0 10px; font-size: 18px; }
    .meta { color: #4b5563; margin-bottom: 24px; }
    .slide { border: 1px solid #d1d5db; border-radius: 8px; margin: 0 0 16px; padding: 18px; page-break-inside: avoid; }
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 16px 0 24px; }
    .kpi { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; }
    .kpi small { color: #6b7280; display: block; }
    .kpi strong { display: block; font-size: 22px; margin-top: 4px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
    th { color: #4b5563; font-size: 11px; text-transform: uppercase; }
    @media print {
      body { margin: 18mm; }
      .slide { min-height: 120px; }
    }
  </style>
</head>
<body>
  <h1>Текущий статус ИТ проектов</h1>
  <div class="meta">Период: ${formatDate(report.period.from_date)} - ${formatDate(report.period.to_date)} · ${escapeHtml(report.scope_label)} · сформировано ${formatDateTime(report.generated_at)}</div>
  <section class="kpis">
    ${report.kpis.map((kpi) => `<div class="kpi"><small>${escapeHtml(kpi.label)}</small><strong>${kpi.value}${kpi.unit ?? ''}</strong>${kpi.detail ? `<small>${escapeHtml(kpi.detail)}</small>` : ''}</div>`).join('')}
  </section>
  <h2>Слайды доклада</h2>
  ${deck.map((slide, index) => `<section class="slide"><h3>${index + 1}. ${escapeHtml(slide.title)}</h3><ul>${slide.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul></section>`).join('')}
  <h2>Приложение: проекты</h2>
  <table>
    <thead><tr><th>Проект</th><th>Статус</th><th>Ответственный</th><th>Прогресс</th><th>Риски</th><th>Дедлайн</th></tr></thead>
    <tbody>${projectRows || '<tr><td colspan="6">Нет данных</td></tr>'}</tbody>
  </table>
</body>
</html>`
}

function openPrintableReport(report: StatusSnapshotReport) {
  const blob = new Blob([buildReportHtml(report)], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function Reports() {
  const [from, setFrom] = useState(defaultFromDate)
  const [to, setTo] = useState(todayDate)
  const [copied, setCopied] = useState(false)
  const [isPptxExporting, setIsPptxExporting] = useState(false)
  const [isPdfExporting, setIsPdfExporting] = useState(false)

  const { data: report, isLoading, isFetching, refetch } = useStatusSnapshotReport({ from, to })

  const generatedLabel = useMemo(() => {
    if (!report?.generated_at) return ''
    return new Date(report.generated_at).toLocaleString('ru-RU')
  }, [report])
  const reportMarkdown = useMemo(() => (report ? buildReportMarkdown(report) : ''), [report])
  const reportDeck = useMemo(() => (report ? buildReportDeck(report) : []), [report])

  async function copyReport() {
    if (!reportMarkdown) return
    await navigator.clipboard.writeText(reportMarkdown)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  async function downloadPptx() {
    if (!report) return
    setIsPptxExporting(true)
    try {
      const payload = await api.downloadStatusSnapshotPresentation({ from, to })
      downloadBlob(`plannerbro-status-${filenamePeriod(report)}.pptx`, payload, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    } finally {
      setIsPptxExporting(false)
    }
  }

  async function downloadPdf() {
    if (!report) return
    setIsPdfExporting(true)
    try {
      const payload = await api.downloadStatusSnapshotPresentationPdf({ from, to })
      downloadBlob(`plannerbro-status-${filenamePeriod(report)}.pdf`, payload, 'application/pdf')
    } finally {
      setIsPdfExporting(false)
    }
  }

  return (
    <div className="space-y-5 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Отчёты</h1>
          <p className="text-sm text-muted-foreground">
            Snapshot для доклада «Текущий статус ИТ проектов»
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">С</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">По</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-36" />
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>
      </div>

      {isLoading && <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Собираю отчёт...</div>}

      {report && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
            <div className="text-sm">
              <span className="font-medium">{report.scope_label}</span>
              <span className="text-muted-foreground"> · {formatDate(report.period.from_date)} - {formatDate(report.period.to_date)} · сформировано {generatedLabel}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={downloadPptx} disabled={isPptxExporting}>
                <Presentation className="mr-2 h-4 w-4" />
                {isPptxExporting ? 'Собираю PPTX' : 'PPTX'}
              </Button>
              <Button variant="outline" size="sm" onClick={downloadPdf} disabled={isPdfExporting}>
                <Printer className="mr-2 h-4 w-4" />
                {isPdfExporting ? 'Собираю PDF' : 'PDF'}
              </Button>
              <Button size="sm" onClick={copyReport}>
                <Clipboard className="mr-2 h-4 w-4" />
                {copied ? 'Скопировано' : 'Скопировать доклад'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadBlob(`plannerbro-report-${filenamePeriod(report)}.md`, reportMarkdown, 'text/markdown;charset=utf-8')}>
                <FileText className="mr-2 h-4 w-4" />
                Markdown
              </Button>
              <Button variant="outline" size="sm" onClick={() => openPrintableReport(report)}>
                <Printer className="mr-2 h-4 w-4" />
                Печать/PDF
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {report.kpis.map((kpi) => (
              <div key={kpi.id} className={`rounded-lg border p-4 ${kpiTone(kpi)}`}>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {kpi.value}{kpi.unit ?? ''}
                </p>
                {kpi.detail && <p className="mt-1 text-xs text-muted-foreground">{kpi.detail}</p>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <section className="rounded-lg border bg-card p-4 xl:col-span-5">
              <h2 className="mb-3 text-sm font-semibold">Портфель по отделам</h2>
              <div className="space-y-3">
                {report.departments.length === 0 && <p className="text-sm text-muted-foreground">Нет данных.</p>}
                {report.departments.map((department) => (
                  <div key={department.id ?? 'none'} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{department.name}</p>
                      <span className="text-xs text-muted-foreground">{department.projects_total} проектов</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${department.progress_percent}%` }} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Прогресс {department.progress_percent}% · задач {department.done_tasks}/{department.tasks_total} · просрочено {department.overdue_tasks}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4 xl:col-span-4">
              <h2 className="mb-3 text-sm font-semibold">Риски</h2>
              <div className="max-h-[460px] space-y-2 overflow-auto pr-1">
                {report.risks.length === 0 && <p className="text-sm text-muted-foreground">Критических рисков не найдено.</p>}
                {report.risks.slice(0, 20).map((risk) => (
                  <div key={`${risk.kind}-${risk.id}`} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{risk.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {risk.project_name ?? (risk.kind === 'project' ? 'Проект' : 'Задача')} · дедлайн {formatDate(risk.end_date)}
                        </p>
                      </div>
                      {riskBadge(risk.risk_level)}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{risk.reason}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4 xl:col-span-3">
              <h2 className="mb-3 text-sm font-semibold">Динамика периода</h2>
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Создано задач" value={report.activity.tasks_created} />
                <MiniStat label="Обновлено" value={report.activity.tasks_updated} />
                <MiniStat label="Завершено" value={report.activity.tasks_completed} />
                <MiniStat label="Событий" value={report.activity.task_events} />
                <MiniStat label="Переносов" value={report.activity.deadline_shifts} />
              </div>

              <h2 className="mb-3 mt-5 text-sm font-semibold">Структура слайдов</h2>
              <ol className="space-y-2 text-sm">
                {report.slides.map((slide, index) => (
                  <li key={slide.title} className="rounded-md border px-3 py-2">
                    <span className="text-xs text-muted-foreground">{index + 1}. </span>
                    {slide.title}
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Готовый доклад</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Слайды собраны из текущего snapshot: KPI, отделы, проекты в фокусе, риски, динамика и решения.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadJson(`plannerbro-deck-${filenamePeriod(report)}.json`, reportDeck)}>
                  <Presentation className="mr-2 h-4 w-4" />
                  Deck JSON
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadBlob(`plannerbro-report-${filenamePeriod(report)}.html`, buildReportHtml(report), 'text/html;charset=utf-8')}>
                  <Download className="mr-2 h-4 w-4" />
                  HTML
                </Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {reportDeck.map((slide, index) => (
                <article key={`${slide.title}-${index}`} className="rounded-md border p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">{index + 1}. {slide.title}</h3>
                    {slide.chart && <Badge variant="outline">{slide.chart}</Badge>}
                  </div>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {slide.bullets.map((bullet) => (
                      <li key={bullet}>- {bullet}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Технические выгрузки</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Эти файлы нужны для внешней обработки данных, не для ручной сборки доклада.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadJson(`plannerbro-status-snapshot-${filenamePeriod(report)}.json`, report)}>
                  <FileJson className="mr-2 h-4 w-4" />
                  Snapshot JSON
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadJson(`plannerbro-status-slides-${filenamePeriod(report)}.json`, report.slides)}>
                  <Presentation className="mr-2 h-4 w-4" />
                  API Slides JSON
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportProjectCsv(report)}>
                  <Download className="mr-2 h-4 w-4" />
                  CSV проектов
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Проекты для приложения к докладу</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 text-left">Проект</th>
                    <th className="py-2 pr-3 text-left">Статус</th>
                    <th className="py-2 pr-3 text-left">Ответственный</th>
                    <th className="py-2 pr-3 text-left">Прогресс</th>
                    <th className="py-2 pr-3 text-left">Риски</th>
                    <th className="py-2 text-left">Дедлайн</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.projects.map((project) => (
                    <tr key={project.id}>
                      <td className="max-w-sm py-2 pr-3 font-medium">
                        <a href={`/projects/${project.id}`} className="hover:text-primary">{project.name}</a>
                        {project.department_names.length > 0 && (
                          <p className="text-xs text-muted-foreground">{project.department_names.join(', ')}</p>
                        )}
                      </td>
                      <td className="py-2 pr-3">{project.status_label}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{project.owner_name}</td>
                      <td className="py-2 pr-3 tabular-nums">{project.done_tasks}/{project.total_tasks} · {project.progress_percent}%</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {project.risk_reasons.length > 0 ? project.risk_reasons.join('; ') : '-'}
                      </td>
                      <td className="py-2">{formatDate(project.end_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function MiniStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'danger' }) {
  return (
    <div className={`rounded-md border p-3 ${tone === 'danger' ? 'border-red-200 bg-red-50 text-red-950 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100' : ''}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}
