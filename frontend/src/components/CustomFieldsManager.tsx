/**
 * CustomFieldsManager — shown in ProjectDetail (settings area, managers only).
 * Lets managers define custom fields for the project.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useCustomFields,
  useCreateCustomField,
  useUpdateCustomField,
  useDeleteCustomField,
  type CustomFieldDef,
} from '@/hooks/useProjects'
import { Trash2, Plus, GripVertical } from 'lucide-react'

const TYPE_LABELS: Record<string, string> = {
  text:   'Текст',
  number: 'Число',
  date:   'Дата',
  select: 'Список',
}

interface Props {
  projectId: string
  canManage: boolean
}

export function CustomFieldsManager({ projectId, canManage }: Props) {
  const { data: fields = [] } = useCustomFields(projectId)
  const createField  = useCreateCustomField()
  const deleteField  = useDeleteCustomField()

  const [name, setName]         = useState('')
  const [type, setType]         = useState<'text' | 'number' | 'date' | 'select'>('text')
  const [options, setOptions]   = useState('')  // comma-separated

  const handleCreate = async () => {
    if (!name.trim()) return
    const opts = type === 'select'
      ? options.split(',').map(s => s.trim()).filter(Boolean)
      : undefined
    await createField.mutateAsync({
      projectId,
      data: {
        name: name.trim(),
        field_type: type,
        options: opts,
        required: false,
        sort_order: fields.length,
      },
    })
    setName('')
    setOptions('')
    setType('text')
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Кастомные поля проекта</p>
      <p className="text-xs text-muted-foreground">
        Поля отображаются в карточке каждой задачи этого проекта.
      </p>

      {/* Existing fields */}
      {fields.length > 0 ? (
        <div className="space-y-2">
          {fields.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <GripVertical className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="flex-1 text-sm font-medium">{f.name}</span>
              <span className="text-xs text-muted-foreground bg-background border rounded px-2 py-0.5">
                {TYPE_LABELS[f.field_type] ?? f.field_type}
              </span>
              {f.field_type === 'select' && f.options && (
                <span className="text-xs text-muted-foreground truncate max-w-32">
                  {f.options.join(', ')}
                </span>
              )}
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteField.mutate({ projectId, fieldId: f.id })}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Полей пока нет.</p>
      )}

      {/* Add new field */}
      {canManage && (
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Добавить поле</p>
          <div className="flex gap-2 flex-wrap">
            <Input
              className="flex-1 min-w-32 h-8 text-sm"
              placeholder="Название поля"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'text' | 'number' | 'date' | 'select')}
              className="h-8 text-sm border rounded px-2 bg-background"
            >
              {Object.entries(TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <Button
              size="sm"
              className="h-8"
              onClick={handleCreate}
              disabled={!name.trim() || createField.isPending}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Добавить
            </Button>
          </div>
          {type === 'select' && (
            <Input
              className="h-8 text-sm"
              placeholder="Варианты через запятую: Да, Нет, В процессе"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
            />
          )}
        </div>
      )}
    </div>
  )
}
