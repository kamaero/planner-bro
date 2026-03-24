import { useState, useMemo, useEffect } from 'react'
import {
  useProjectFiles,
  useAIDrafts,
  useAIJobs,
  useStartAIProcessing,
  useUploadProjectFile,
  useImportMSProjectTasks,
  useDeleteProjectFile,
  useApproveAIDraft,
  useApproveAIDraftsBulk,
  useRejectAIDraft,
  useRejectAIDraftsBulk,
} from '@/hooks/useProjects'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Download, Trash2 } from 'lucide-react'
import { humanizeApiError } from '@/lib/errorMessages'
import { formatUserDisplayName } from '@/lib/userName'
import type { ProjectFile } from '@/types'

interface Props {
  projectId: string
  canImport: boolean
  canManage: boolean
  onDownload: (file: ProjectFile) => void
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getAIStatusMeta(status?: string) {
  if (status === 'processing') return { label: 'В обработке', percent: 60, bar: 'bg-blue-500' }
  if (status === 'completed') return { label: 'Готово', percent: 100, bar: 'bg-emerald-500' }
  if (status === 'failed') return { label: 'Ошибка', percent: 100, bar: 'bg-red-500' }
  if (status === 'queued') return { label: 'В очереди', percent: 15, bar: 'bg-amber-500' }
  return { label: 'Нет задачи AI', percent: 0, bar: 'bg-muted-foreground' }
}

export function ProjectDetailFilesSection({ projectId, canImport, canManage, onDownload }: Props) {
  const { data: files = [] } = useProjectFiles(projectId)
  const { data: aiDrafts = [] } = useAIDrafts(projectId, 'pending')
  const { data: aiJobs = [] } = useAIJobs(projectId)

  const startAIProcessing = useStartAIProcessing()
  const uploadProjectFile = useUploadProjectFile()
  const importMSProjectTasks = useImportMSProjectTasks()
  const deleteProjectFile = useDeleteProjectFile()
  const approveAIDraft = useApproveAIDraft()
  const approveAIDraftsBulk = useApproveAIDraftsBulk()
  const rejectAIDraft = useRejectAIDraft()
  const rejectAIDraftsBulk = useRejectAIDraftsBulk()

  const [fileToUpload, setFileToUpload] = useState<File | null>(null)
  const [msProjectFile, setMSProjectFile] = useState<File | null>(null)
  const [replaceExistingMSImport, setReplaceExistingMSImport] = useState(true)
  const [aiPromptInstruction, setAIPromptInstruction] = useState('')
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([])

  useEffect(() => {
    const ids = new Set(aiDrafts.map((d) => d.id))
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

  const allDraftsSelected = aiDrafts.length > 0 && aiDrafts.every((d) => selectedDraftIds.includes(d.id))

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

  const handleApproveDraft = async (draftId: string) => {
    await approveAIDraft.mutateAsync({ projectId, draftId })
  }

  const handleRejectDraft = async (draftId: string) => {
    await rejectAIDraft.mutateAsync({ projectId, draftId })
  }

  const handleApproveSelectedDrafts = async () => {
    if (selectedDraftIds.length === 0) return
    await approveAIDraftsBulk.mutateAsync({ projectId, draftIds: selectedDraftIds })
  }

  const handleRejectSelectedDrafts = async () => {
    if (selectedDraftIds.length === 0) return
    if (!window.confirm(`Удалить выбранные черновики (${selectedDraftIds.length})?`)) return
    await rejectAIDraftsBulk.mutateAsync({ projectId, draftIds: selectedDraftIds })
  }

  const handleToggleAllDrafts = () => {
    if (allDraftsSelected) {
      setSelectedDraftIds([])
    } else {
      setSelectedDraftIds(aiDrafts.map((d) => d.id))
    }
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
            <Switch
              checked={replaceExistingMSImport}
              onCheckedChange={setReplaceExistingMSImport}
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
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
            >
              {(() => {
                const aiJob = latestJobByFile[file.id]
                const meta = getAIStatusMeta(aiJob?.status)
                const canRun = canImport && aiJob?.status !== 'processing'
                const actionLabel =
                  !aiJob
                    ? 'Запустить ИИ'
                    : aiJob.status === 'failed'
                      ? 'Повторить ИИ'
                      : aiJob.status === 'completed'
                        ? 'Запустить заново'
                        : aiJob.status === 'queued'
                          ? 'Запустить сейчас'
                          : 'Обновляется...'

                return (
                  <>
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
                  <Button variant="outline" size="sm" onClick={() => onDownload(file)}>
                    <Download className="w-4 h-4 mr-1" />
                    Скачать
                  </Button>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        deleteProjectFile.mutate({ projectId, fileId: file.id })
                      }
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  )}
                </div>
                  </>
                )
              })()}
            </div>
          ))}
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
            {aiDrafts.map((draft) => (
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
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
