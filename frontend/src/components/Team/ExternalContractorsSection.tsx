import { useState } from 'react'
import { useExternalContractors, useCreateExternalContractor, useDeleteExternalContractor } from '@/hooks/useProjects'
import { Button } from '@/components/ui/button'

export function ExternalContractorsSection() {
  const { data: contractors = [] } = useExternalContractors()
  const create = useCreateExternalContractor()
  const remove = useDeleteExternalContractor()
  const [name, setName] = useState('')

  const handleAdd = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    await create.mutateAsync(trimmed)
    setName('')
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <p className="text-sm font-semibold">Внешние исполнители</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Подрядчики и внешние организации, которых можно назначить блокером задачи.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 h-8 text-sm border rounded px-3 bg-background"
          placeholder="Название / ФИО подрядчика"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Button size="sm" className="h-8" onClick={handleAdd} disabled={!name.trim() || create.isPending}>
          Добавить
        </Button>
      </div>

      {contractors.length === 0 ? (
        <p className="text-xs text-muted-foreground">Список пуст.</p>
      ) : (
        <div className="space-y-1">
          {contractors.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
              <span className="text-sm">{c.name}</span>
              <Button
                variant="ghost" size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => remove.mutate(c.id)}
                disabled={remove.isPending}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
