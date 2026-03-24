/**
 * ExternalDepsPanel — shown in TaskDrawer.
 * Pick a contractor from the global list, set status and optional due date.
 */
import { useState } from 'react'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useExternalDeps,
  useCreateExternalDep,
  useUpdateExternalDep,
  useDeleteExternalDep,
  useExternalContractors,
  type ExternalDep,
} from '@/hooks/useProjects'
import { humanizeApiError } from '@/lib/errorMessages'

const STATUS_LABELS: Record<string, string> = {
  waiting:  'Ждём',
  testing:  'На тестировании',
  received: 'Получено',
  overdue:  'Просрочено',
}

const STATUS_COLORS: Record<string, string> = {
  waiting:  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  testing:  'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  received: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  overdue:  'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const STATUSES = ['waiting', 'testing', 'received', 'overdue'] as const

interface Props { taskId: string }

interface DraftDep {
  contractor_name: string
  due_date: string
  status: string
}

function DepForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: DraftDep
  onSave: (d: DraftDep) => void
  onCancel: () => void
  saving: boolean
}) {
  const [d, setD] = useState<DraftDep>(initial)
  const { data: contractors = [] } = useExternalContractors()

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
      <select
        value={d.contractor_name}
        onChange={(e) => setD((p) => ({ ...p, contractor_name: e.target.value }))}
        className="w-full h-8 text-sm border rounded px-2 bg-background"
      >
        <option value="">— выберите подрядчика —</option>
        {contractors.map((c) => (
          <option key={c.id} value={c.name}>{c.name}</option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          type="date"
          value={d.due_date}
          onChange={(e) => setD((p) => ({ ...p, due_date: e.target.value }))}
          className="flex-1 h-8 text-sm border rounded px-2 bg-background"
          placeholder="Срок"
        />
        <select
          value={d.status}
          onChange={(e) => setD((p) => ({ ...p, status: e.target.value }))}
          className="h-8 text-sm border rounded px-2 bg-background"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" className="h-7" onClick={onCancel} disabled={saving}>
          <X className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm" className="h-7"
          onClick={() => onSave(d)}
          disabled={!d.contractor_name || saving}
        >
          <Check className="w-3.5 h-3.5 mr-1" />
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </div>
    </div>
  )
}

function DepRow({ dep, taskId }: { dep: ExternalDep; taskId: string }) {
  const [editing, setEditing] = useState(false)
  const updateDep = useUpdateExternalDep()
  const deleteDep = useDeleteExternalDep()

  const handleSave = async (d: DraftDep) => {
    try {
      await updateDep.mutateAsync({
        taskId, depId: dep.id,
        data: { contractor_name: d.contractor_name, due_date: d.due_date || null, status: d.status },
      })
      setEditing(false)
    } catch (err: any) {
      window.alert(humanizeApiError(err, 'Не удалось обновить'))
    }
  }

  if (editing) {
    return (
      <DepForm
        initial={{ contractor_name: dep.contractor_name, due_date: dep.due_date ?? '', status: dep.status }}
        onSave={handleSave}
        onCancel={() => setEditing(false)}
        saving={updateDep.isPending}
      />
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{dep.contractor_name}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[dep.status]}`}>
            {STATUS_LABELS[dep.status] ?? dep.status}
          </span>
          {dep.due_date && (
            <span className="text-xs text-muted-foreground">
              до {new Date(dep.due_date + 'T00:00:00').toLocaleDateString('ru-RU')}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-1 shrink-0">
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setEditing(true)}>
          <Pencil className="w-3 h-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
          onClick={() => deleteDep.mutate({ taskId, depId: dep.id })}
          disabled={deleteDep.isPending}>
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  )
}

export function ExternalDepsPanel({ taskId }: Props) {
  const { data: deps = [] } = useExternalDeps(taskId)
  const createDep = useCreateExternalDep()
  const [adding, setAdding] = useState(false)

  const handleCreate = async (d: DraftDep) => {
    try {
      await createDep.mutateAsync({
        taskId,
        data: { contractor_name: d.contractor_name, due_date: d.due_date || null, status: d.status },
      })
      setAdding(false)
    } catch (err: any) {
      window.alert(humanizeApiError(err, 'Не удалось добавить подрядчика'))
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Внешние исполнители
        </p>
        {!adding && (
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-muted-foreground"
            onClick={() => setAdding(true)}>
            <Plus className="w-3 h-3 mr-1" />
            Добавить
          </Button>
        )}
      </div>

      {deps.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">Нет внешних исполнителей.</p>
      )}

      <div className="space-y-2">
        {deps.map((dep) => <DepRow key={dep.id} dep={dep} taskId={taskId} />)}
        {adding && (
          <DepForm
            initial={{ contractor_name: '', due_date: '', status: 'waiting' }}
            onSave={handleCreate}
            onCancel={() => setAdding(false)}
            saving={createDep.isPending}
          />
        )}
      </div>
    </div>
  )
}
