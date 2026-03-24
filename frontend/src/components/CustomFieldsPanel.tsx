/**
 * CustomFieldsPanel — shown inside TaskDrawer.
 * Displays and edits custom field values for a specific task.
 */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCustomFields, useTaskCustomValues, useSaveTaskCustomValues } from '@/hooks/useProjects'
import { humanizeApiError } from '@/lib/errorMessages'

interface Props {
  taskId: string
  projectId: string
}

export function CustomFieldsPanel({ taskId, projectId }: Props) {
  const { data: fields = [] } = useCustomFields(projectId)
  const { data: storedValues = {} } = useTaskCustomValues(taskId)
  const saveValues = useSaveTaskCustomValues()

  const [draft, setDraft] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)

  // Initialise draft from stored values whenever they load
  useEffect(() => {
    if (!fields.length) return
    const init: Record<string, string> = {}
    for (const f of fields) {
      init[f.id] = storedValues[f.id] ?? ''
    }
    setDraft(init)
    setDirty(false)
  }, [fields, storedValues])

  if (!fields.length) return null

  const handleChange = (fieldId: string, value: string) => {
    setDraft((d) => ({ ...d, [fieldId]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    const payload: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(draft)) {
      payload[k] = v.trim() || null
    }
    try {
      await saveValues.mutateAsync({ taskId, values: payload })
      setDirty(false)
    } catch (err: any) {
      window.alert(humanizeApiError(err, 'Не удалось сохранить кастомные поля'))
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Дополнительные поля
      </p>
      <div className="space-y-2">
        {fields.map((f) => (
          <div key={f.id}>
            <label className="text-xs text-muted-foreground mb-1 block">
              {f.name}
              {f.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {f.field_type === 'select' ? (
              <select
                value={draft[f.id] ?? ''}
                onChange={(e) => handleChange(f.id, e.target.value)}
                className="w-full text-sm border rounded px-2 py-1 bg-background"
              >
                <option value="">— выберите —</option>
                {(f.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : f.field_type === 'date' ? (
              <input
                type="date"
                value={draft[f.id] ?? ''}
                onChange={(e) => handleChange(f.id, e.target.value)}
                className="w-full text-sm border rounded px-2 py-1 bg-background"
              />
            ) : f.field_type === 'number' ? (
              <input
                type="number"
                step="any"
                value={draft[f.id] ?? ''}
                onChange={(e) => handleChange(f.id, e.target.value)}
                className="w-full text-sm border rounded px-2 py-1 bg-background"
              />
            ) : (
              <input
                type="text"
                value={draft[f.id] ?? ''}
                onChange={(e) => handleChange(f.id, e.target.value)}
                className="w-full text-sm border rounded px-2 py-1 bg-background"
                placeholder={`Введите ${f.name.toLowerCase()}`}
              />
            )}
          </div>
        ))}
      </div>
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={saveValues.isPending}
        >
          {saveValues.isPending ? 'Сохранение...' : 'Сохранить поля'}
        </Button>
      )}
    </div>
  )
}
