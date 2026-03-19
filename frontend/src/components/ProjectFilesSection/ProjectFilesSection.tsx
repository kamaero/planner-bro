import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Trash2 } from 'lucide-react'

import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useAIJobs,
  useAIDrafts,
  useApproveAIDraft,
  useApproveAIDraftsBulk,
  useDeleteProjectFile,
  useImportMSProjectTasks,
  useProjectFiles,
  useRejectAIDraft,
  useRejectAIDraftsBulk,
  useStartAIProcessing,
  useUploadProjectFile,
} from '@/hooks/useProjects'
import { humanizeApiError } from '@/lib/errorMessages'
import { formatUserDisplayName } from '@/lib/userName'
import type { AITaskDraft, ImportFilePrecheck, ProjectFile } from '@/types'

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

interface ProjectFilesSectionProps {
  projectId: string
  canImport: boolean
  canManage: boolean
}

export function ProjectFilesSection({
  projectId,
  canImport,
  canManage,
}: ProjectFilesSectionProps) {
  const { data: files = [] } = useProjectFiles(projectId)
  const { data: aiJobs = [] } = useAIJobs(projectId)
  const { data: aiDrafts = [] } = useAIDrafts(projectId, 'pending')
  const uploadProjectFile = useUploadProjectFile()
  const importMSProjectTasks = useImportMSProjectTasks()
  const deleteProjectFile = useDeleteProjectFile()
  const startAIProcessing = useStartAIProcessing()
  const approveAIDraft = useApproveAIDraft()
  const approveAIDraftsBulk = useApproveAIDraftsBulk()
  const rejectAIDraft = useRejectAIDraft()
  const rejectAIDraftsBulk = useRejectAIDraftsBulk()

  const [fileToUpload, setFileToUpload] = useState<File | null>(null)
  const [msProjectFile, setMSProjectFile] = useState<File | null>(null)
  const [replaceExistingMSImport, setReplaceExistingMSImport] = useState(true)
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([])
  const [aiPromptInstruction, setAIPromptInstruction] = useState('')
  const [fileImportPrechecks, setFileImportPrechecks] = useState<Record<string, ImportFilePrecheck>>({})

  const importFilePrecheck = useMemo(() => {
    if (!msProjectFile) return null
    const name = msProjectFile.name.toLowerCase()
    const isXlsx = name.endsWith('.xlsx')
    const isXml = name.endsWith('.xml')
    const isMpp = name.endsWith('.mpp')
    return {
      isXlsx,
      isXml,
      isMpp,
      messages: [
        isXlsx
          ? 'Таблица XLSX выбрана. Лучше всего сработают явные колонки: Наименование, Срок, Исполнитель, Заказчик, Вид задачи.'
          : null,
        isXml
          ? 'XML выбран. Для импорта структуры это предпочтительный формат MS Project.'
          : null,
        isMpp
          ? 'MPP выбран. Если импорт даст нестабильный результат, лучше выгрузить XML/MSPDI.'
          : null,
        !isXlsx && !isXml && !isMpp
          ? 'Формат выглядит нестандартно для импорта задач. Лучше использовать XML/MSPDI, MPP или XLSX.'
          : null,
      ].filter(Boolean) as string[],
    }
  }, [msProjectFile])

  useEffect(() => {
    let cancelled = false
    const xlsxFiles = files.filter((file) => file.filename.toLowerCase().endsWith('.xlsx'))
    if (xlsxFiles.length === 0) {
      setFileImportPrechecks({})
      return () => {
        cancelled = true
      }
    }

    void Promise.all(
      xlsxFiles.map(async (file) => {
        try {
          const precheck = (await api.getImportFilePrecheck(projectId, file.id)) as ImportFilePrecheck
          return [file.id, precheck] as const
        } catch {
          return [
            file.id,
            {
              file_type: 'xlsx',
              detected_headers: [],
              recognized_columns: [],
              missing_columns: [],
              warnings: ['Не удалось проверить структуру XLSX до запуска ИИ.'],
              can_start_ai: true,
            } satisfies ImportFilePrecheck,
          ] as const
        }
      })
    ).then((entries) => {
      if (cancelled) return
      setFileImportPrechecks(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [files, projectId])

  useEffect(() => {
    const ids = new Set(aiDrafts.map((draft) => draft.id))
    setSelectedDraftIds((prev) => prev.filter((id) => ids.has(id)))
  }, [aiDrafts])

  const latestJobByFile = useMemo(() => {
    const map: Record<string, (typeof aiJobs)[number]> = {}
    aiJobs.forEach((job) => {
      const existing = map[job.project_file_id]
      if (!existing || existing.created_at < job.created_at) {
        map[job.project_file_id] = job
      }
    })
    return map
  }, [aiJobs])

  const allDraftsSelected = aiDrafts.length > 0 && aiDrafts.every((draft) => selectedDraftIds.includes(draft.id))

  const getAIStatusMeta = (status?: string) => {
    if (status === 'processing') return { label: 'В обработке', percent: 60, bar: 'bg-blue-500' }
    if (status === 'completed') return { label: 'Готово', percent: 100, bar: 'bg-emerald-500' }
    if (status === 'failed') return { label: 'Ошибка', percent: 100, bar: 'bg-red-500' }
    if (status === 'queued') return { label: 'В очереди', percent: 15, bar: 'bg-amber-500' }
    return { label: 'Нет задачи AI', percent: 0, bar: 'bg-muted-foreground' }
  }

  const getDraftAssigneeMeta = (draft: AITaskDraft) => {
    const payload = draft.raw_payload ?? {}
    const assigneeHints = Array.isArray(payload.assignee_hints)
      ? payload.assignee_hints.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : draft.assignee_hint
        ? [draft.assignee_hint]
        : []
    const matchedAssigneeIds = Array.isArray(payload.matched_assignee_ids)
      ? payload.matched_assignee_ids.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : draft.assigned_to_id
        ? [draft.assigned_to_id]
        : []

    if (matchedAssigneeIds.length > 0 && assigneeHints.length > matchedAssigneeIds.length) {
      return {
        label: `Частично распознан: ${matchedAssigneeIds.length} из ${assigneeHints.length}`,
        tone: 'border-amber-200 bg-amber-50 text-amber-700',
      }
    }
    if (matchedAssigneeIds.length > 0) {
      return {
        label: draft.assignee
          ? `Распознан: ${formatUserDisplayName(draft.assignee)}`
          : 'Исполнитель распознан точно',
        tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      }
    }
    if (assigneeHints.length > 0) {
      return {
        label: `Временное имя: ${assigneeHints.join(', ')}`,
        tone: 'border-orange-200 bg-orange-50 text-orange-700',
      }
    }
    return {
      label: 'Исполнитель не указан',
      tone: 'border-slate-200 bg-slate-50 text-slate-600',
    }
  }

  const handleUploadFile = async () => {
    if (!fileToUpload) return
    try {
      await uploadProjectFile.mutateAsync({ projectId, file: fileToUpload })
      setFileToUpload(null)
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось загрузить файл'))
    }
  }

  const handleImportMSProject = async () => {
    if (!msProjectFile) return
    try {
      const result = await importMSProjectTasks.mutateAsync({
        projectId,
        file: msProjectFile,
        replaceExisting: replaceExistingMSImport,
      })
      setMSProjectFile(null)
      window.alert(
        `Импорт завершен.\nСоздано: ${result.created}\nСвязано с родителем: ${result.linked_to_parent}\nУдалено старых импортированных: ${result.deleted_existing}\nПропущено: ${result.skipped}`
      )
    } catch (error: any) {
      window.alert(humanizeApiError(error, 'Не удалось импортировать задачи из MS Project'))
    }
  }

  const handleDownload = async (file: ProjectFile) => {
    const res = await api.downloadProjectFile(projectId, file.id)
    const blob = new Blob([res.data], { type: file.content_type || 'application/octet-stream' })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.URL.revokeObjectURL(url)
  }

  const handleApproveDraft = async (draftId: string) => {
    await approveAIDraft.mutateAsync({ projectId, draftId })
  }

  const handleRejectDraft = async (draftId: string) => {
    await rejectAIDraft.mutateAsync({ projectId, draftId })
  }

  const handleApproveSelectedDrafts = async () => {
    if (selectedDraftIds.length === 0) return
    await approveAIDraftsBulk.mutateAsync({ projectId, draftIds: selectedDraftIds })
    setSelectedDraftIds([])
  }

  const handleRejectSelectedDrafts = async () => {
    if (selectedDraftIds.length === 0) return
    if (!window.confirm(`Удалить выбранные черновики (${selectedDraftIds.length})?`)) return
    await rejectAIDraftsBulk.mutateAsync({ projectId, draftIds: selectedDraftIds })
    setSelectedDraftIds([])
  }

  const handleToggleAllDrafts = () => {
    if (allDraftsSelected) {
      setSelectedDraftIds([])
      return
    }
    setSelectedDraftIds(aiDrafts.map((draft) => draft.id))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Input
            type="file"
            onChange={(e) => setFileToUpload(e.target.files?.[0] ?? null)}
          />
          <Button
            variant="outline"
            onClick={handleUploadFile}
            disabled={!fileToUpload || uploadProjectFile.isPending || !canImport}
          >
            {uploadProjectFile.isPending ? 'Загрузка...' : 'Загрузить файл'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Единая загрузка: XML/MSPDI, PDF, DOC/DOCX, PPTX, XLSX и текстовые форматы. После обработки черновиков
          файл автоматически переносится в зашифрованное Хранилище (`Processed`) или его можно удалить вручную.
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <p className="text-sm font-medium">Импорт задач (MS Project XML/MSPDI, MPP, XLSX)</p>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <Input
            type="file"
            accept=".xml,.mpp,.xlsx"
            onChange={(e) => setMSProjectFile(e.target.files?.[0] ?? null)}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground md:min-w-fit">
            <span>Заменить предыдущий импорт MS Project</span>
            <input
              type="checkbox"
              checked={replaceExistingMSImport}
              onChange={(e) => setReplaceExistingMSImport(e.target.checked)}
              className="h-4 w-4"
            />
          </label>
          <Button
            variant="outline"
            onClick={handleImportMSProject}
            disabled={!msProjectFile || importMSProjectTasks.isPending || !canImport}
          >
            {importMSProjectTasks.isPending ? 'Импорт...' : 'Импортировать задачи'}
          </Button>
        </div>
        {importFilePrecheck && (
          <div className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Быстрая проверка файла</p>
            <div className="mt-2 space-y-1.5">
              <p>Файл: {msProjectFile?.name}</p>
              {importFilePrecheck.messages.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-foreground">Подсказка по импорту</p>
            <Link
              to="/help#import"
              className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
            >
              Подробнее в Help
            </Link>
          </div>
          <div className="mt-2 space-y-1.5">
            <p>1. Для MS Project используйте `XML/MSPDI`, а не исходный `.mpp`, если нужен стабильный структурный импорт.</p>
            <p>2. Для XLSX лучше всего работают явные колонки вроде: `Наименование`, `Срок`, `Исполнитель`, `Заказчик`, `Вид задачи`.</p>
            <p>3. Исполнителя система старается распознать по `email` или по форме имени вроде `Фамилия И.О.`.</p>
            <p>4. Если исполнителя ещё нет в системе, имя может попасть во временные назначения для дальнейшей привязки.</p>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-foreground">Мини-гайд по XLSX</p>
            <div className="flex items-center gap-3">
              <a
                href="/templates/plannerbro-import-template.csv"
                download
                className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
              >
                Скачать CSV
              </a>
              <a
                href="/templates/plannerbro-import-template.xlsx"
                download
                className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
              >
                Скачать шаблон XLSX
              </a>
              <Link
                to="/help#import"
                className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
              >
                Полный пример
              </Link>
            </div>
          </div>
          <div className="mt-2 overflow-x-auto rounded border">
            <table className="min-w-full">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-2 py-1 font-medium">Наименование</th>
                  <th className="px-2 py-1 font-medium">Срок</th>
                  <th className="px-2 py-1 font-medium">Исполнитель</th>
                  <th className="px-2 py-1 font-medium">Заказчик</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-2 py-1">Подготовить паспорт предприятия</td>
                  <td className="px-2 py-1">2026-03-16</td>
                  <td className="px-2 py-1">Петров П.П.; ivanova@corp.ru</td>
                  <td className="px-2 py-1">ОМСИО</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-2 space-y-1">
            <p>Если исполнителей несколько, лучше разделять их `;`.</p>
            <p>Даты лучше подавать в явном формате `YYYY-MM-DD`.</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          При включенной замене удаляются только задачи, которые ранее были импортированы из MS Project в этом
          проекте.
        </p>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <Label htmlFor="ai-prompt-instruction">Промпт для ИИ (опционально)</Label>
        <textarea
          id="ai-prompt-instruction"
          value={aiPromptInstruction}
          onChange={(e) => setAIPromptInstruction(e.target.value)}
          rows={3}
          maxLength={4000}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Например: 'Строго парси колонку Исполнитель, дедлайн брать из колонки Срок, не пропускать строки без заказчика'."
        />
        <p className="text-xs text-muted-foreground">
          Эти указания применяются при нажатии «Запустить ИИ/Запустить сейчас» для файла.
        </p>
      </div>
      {!canImport && (
        <p className="text-xs text-muted-foreground">
          У вас нет права `import` для загрузки/обработки файлов.
        </p>
      )}

      {files.length === 0 ? (
        <div className="text-sm text-muted-foreground">Файлов пока нет.</div>
      ) : (
        <div className="space-y-2">
          {files.map((file) => {
            const aiJob = latestJobByFile[file.id]
            const meta = getAIStatusMeta(aiJob?.status)
            const filePrecheck = fileImportPrechecks[file.id]
            const isXlsx = file.filename.toLowerCase().endsWith('.xlsx')
            const canRun = canImport && aiJob?.status !== 'processing' && (!isXlsx || filePrecheck?.can_start_ai !== false)
            const actionLabel =
              isXlsx && filePrecheck?.can_start_ai === false
                ? 'Исправьте XLSX'
                : !aiJob
                  ? 'Запустить ИИ'
                  : aiJob.status === 'failed'
                    ? 'Повторить ИИ'
                    : aiJob.status === 'completed'
                      ? 'Запустить заново'
                      : aiJob.status === 'queued'
                        ? 'Запустить сейчас'
                        : 'Обновляется...'

            return (
              <div
                key={file.id}
                className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{file.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)} ·{' '}
                    {new Date(file.created_at).toLocaleDateString()} ·{' '}
                    {formatUserDisplayName(file.uploaded_by) || 'Неизвестно'}
                  </p>
                  <p className="text-xs mt-1 text-muted-foreground">
                    AI: {meta.label}
                    {aiJob?.status === 'completed' ? ` · черновиков: ${aiJob.drafts_count}` : ''}
                    {aiJob?.status === 'failed' && aiJob.error_message ? ` · ${aiJob.error_message}` : ''}
                  </p>
                  {filePrecheck && (
                    <div className="mt-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                      <p className="font-medium text-foreground">
                        Проверка структуры {filePrecheck.file_type.toUpperCase()}
                      </p>
                      {filePrecheck.detected_headers.length > 0 && (
                        <p className="mt-1 text-muted-foreground">
                          Колонки: {filePrecheck.detected_headers.join(', ')}
                        </p>
                      )}
                      {filePrecheck.recognized_columns.length > 0 && (
                        <p className="mt-1 text-emerald-700">
                          Распознано: {filePrecheck.recognized_columns.join(', ')}
                        </p>
                      )}
                      {filePrecheck.missing_columns.length > 0 && (
                        <p className="mt-1 text-amber-700">
                          Не хватает для уверенного разбора: {filePrecheck.missing_columns.join(', ')}
                        </p>
                      )}
                      {filePrecheck.warnings.map((warning) => (
                        <p key={warning} className="mt-1 text-amber-700">
                          {warning}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${meta.bar} transition-all duration-300`}
                      style={{ width: `${meta.percent}%` }}
                    />
                  </div>
                  {aiJob?.status === 'queued' && (
                    <p className="text-[11px] mt-1 text-amber-700">
                      Файл в очереди. Нажмите «Запустить сейчас», если хотите обработать немедленно.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      startAIProcessing.mutate({
                        projectId,
                        fileId: file.id,
                        promptInstruction: aiPromptInstruction,
                      })
                    }
                    disabled={!canRun || startAIProcessing.isPending}
                  >
                    {startAIProcessing.isPending ? 'Запуск...' : actionLabel}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(file)}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteProjectFile.mutate({ projectId, fileId: file.id })}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div>
            <p className="text-sm font-semibold">AI черновики задач</p>
            <p className="text-xs text-muted-foreground">
              После загрузки документа ИИ предлагает задачи. Подтвердите нужные.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleToggleAllDrafts}
              disabled={aiDrafts.length === 0}
            >
              {allDraftsSelected ? 'Снять всё' : `Выбрать всё (${aiDrafts.length})`}
            </Button>
            <Button
              size="sm"
              onClick={handleApproveSelectedDrafts}
              disabled={selectedDraftIds.length === 0 || approveAIDraftsBulk.isPending}
            >
              {approveAIDraftsBulk.isPending
                ? 'Создание...'
                : `Подтвердить выбранные (${selectedDraftIds.length})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRejectSelectedDrafts}
              disabled={selectedDraftIds.length === 0 || rejectAIDraftsBulk.isPending}
            >
              {rejectAIDraftsBulk.isPending
                ? 'Удаление...'
                : `Удалить выбранные (${selectedDraftIds.length})`}
            </Button>
          </div>
        </div>
        {aiDrafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пока нет pending-черновиков.</p>
        ) : (
          <div className="space-y-2">
            {aiDrafts.map((draft) => {
              const assigneeMeta = getDraftAssigneeMeta(draft)
              return (
                <div key={draft.id} className="rounded-lg border px-3 py-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedDraftIds.includes(draft.id)}
                      onChange={() =>
                        setSelectedDraftIds((prev) =>
                          prev.includes(draft.id)
                            ? prev.filter((id) => id !== draft.id)
                            : [...prev, draft.id]
                        )
                      }
                      className="mt-1 h-4 w-4"
                    />
                    <div className="flex-1 min-w-0">
                      <span className={`mb-2 inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${assigneeMeta.tone}`}>
                        {assigneeMeta.label}
                      </span>
                      <p className="text-sm font-medium truncate">{draft.title}</p>
                      {draft.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{draft.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Приоритет: {draft.priority} · Confidence: {draft.confidence}%
                        {draft.end_date ? ` · Дедлайн: ${new Date(draft.end_date).toLocaleDateString()}` : ''}
                        {draft.assignee_hint ? ` · Кому: ${draft.assignee_hint}` : ''}
                      </p>
                      {draft.source_quote && (
                        <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
                          Источник: {draft.source_quote}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleApproveDraft(draft.id)}
                        disabled={approveAIDraft.isPending}
                      >
                        Подтвердить
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRejectDraft(draft.id)}
                        disabled={rejectAIDraft.isPending}
                      >
                        Отклонить
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
