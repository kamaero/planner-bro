import { useState, useRef } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useVaultFiles, useUploadVaultFile, useDeleteVaultFile, useVaultDownloadToken } from '@/hooks/useVault'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Upload, Trash2, Download, FolderOpen, Lock, File as FileIcon } from 'lucide-react'
import type { VaultFile } from '@/types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const FOLDERS = ['', 'Отчёты', 'Презентации', 'Договоры', 'Прочее']

function FileRow({
  file,
  canDelete,
  onDownload,
  onDelete,
  downloading,
}: {
  file: VaultFile
  canDelete: boolean
  onDownload: (f: VaultFile) => void
  onDelete: (f: VaultFile) => void
  downloading: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 rounded-lg group">
      <FileIcon className="w-5 h-5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(file.size)}
          {file.uploaded_by ? ` · ${file.uploaded_by.name}` : ''}
          {' · '}{formatDate(file.created_at)}
          {file.description ? ` · ${file.description}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDownload(file)}
          disabled={downloading}
          title="Скачать"
        >
          <Download className="w-4 h-4" />
        </Button>
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(file)}
            title="Удалить"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

export function TeamStorage() {
  const { user } = useAuthStore()
  const canDelete = user?.role === 'admin' || user?.can_delete === true

  const [activeFolder, setActiveFolder] = useState<string>('')
  const [search, setSearch] = useState('')
  const [uploadFolder, setUploadFolder] = useState('')
  const [description, setDescription] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: files = [], isLoading } = useVaultFiles(activeFolder || undefined)
  const upload = useUploadVaultFile()
  const deleteFile = useDeleteVaultFile()
  const getToken = useVaultDownloadToken()

  const filtered = files.filter((f) =>
    search ? f.name.toLowerCase().includes(search.toLowerCase()) : true
  )

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0]
    if (!picked) return
    await upload.mutateAsync({
      file: picked,
      folder: uploadFolder || undefined,
      description: description || undefined,
    })
    setDescription('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDownload = async (file: VaultFile) => {
    setDownloadingId(file.id)
    try {
      const result = await getToken.mutateAsync(file.id)
      window.open(result.download_url, '_blank')
    } finally {
      setDownloadingId(null)
    }
  }

  const handleDelete = async (file: VaultFile) => {
    if (!confirm(`Удалить файл «${file.name}»?`)) return
    await deleteFile.mutateAsync(file.id)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Lock className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Защищённое хранилище</h1>
          <p className="text-sm text-muted-foreground">Файлы зашифрованы AES-256-GCM · Доступ только авторизованным участникам</p>
        </div>
      </div>

      {/* Upload panel */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <p className="text-sm font-medium">Загрузить файл</p>
        <div className="flex flex-wrap gap-2">
          <select
            value={uploadFolder}
            onChange={(e) => setUploadFolder(e.target.value)}
            className="text-sm border rounded-md px-2 py-1.5 bg-background"
          >
            <option value="">Без папки</option>
            {FOLDERS.filter(Boolean).map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <Input
            placeholder="Описание (необязательно)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-64 text-sm"
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
          >
            <Upload className="w-4 h-4 mr-2" />
            {upload.isPending ? 'Загрузка...' : 'Выбрать файл'}
          </Button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFilePick} />
        </div>
        {upload.isError && (
          <p className="text-sm text-destructive">Ошибка загрузки: {String(upload.error)}</p>
        )}
      </div>

      {/* Folder tabs + search */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1">
          {FOLDERS.map((f) => (
            <button
              key={f || '__all__'}
              onClick={() => setActiveFolder(f)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeFolder === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              {f ? <FolderOpen className="w-3.5 h-3.5" /> : null}
              {f || 'Все файлы'}
            </button>
          ))}
        </div>
        <Input
          placeholder="Поиск по имени..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 text-sm ml-auto"
        />
      </div>

      {/* File list */}
      <div className="rounded-xl border bg-card divide-y">
        {isLoading && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Загрузка...</div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {search ? 'Файлы не найдены' : 'Хранилище пусто — загрузите первый файл'}
          </div>
        )}
        {filtered.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            canDelete={canDelete}
            onDownload={handleDownload}
            onDelete={handleDelete}
            downloading={downloadingId === file.id}
          />
        ))}
      </div>
    </div>
  )
}
