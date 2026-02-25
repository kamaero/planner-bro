import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface DeadlineReasonModalProps {
  open: boolean
  oldDate: string
  newDate: string
  onConfirm: (reason: string) => void
  onCancel: () => void
}

export function DeadlineReasonModal({
  open,
  oldDate,
  newDate,
  onConfirm,
  onCancel,
}: DeadlineReasonModalProps) {
  const [reason, setReason] = useState('')

  const handleConfirm = () => {
    if (!reason.trim()) return
    onConfirm(reason.trim())
    setReason('')
  }

  const handleCancel = () => {
    setReason('')
    onCancel()
  }

  const formatDate = (d: string) => {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Изменение дедлайна
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Текущий дедлайн:</span>
              <span className="font-medium">{formatDate(oldDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Новый дедлайн:</span>
              <span className="font-medium text-amber-600">{formatDate(newDate)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Причина переноса <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: задержка поставки данных от смежного отдела..."
              className="w-full text-sm border rounded px-3 py-2 bg-background resize-none h-24 focus:outline-none focus:ring-2 focus:ring-ring"
              maxLength={1000}
              autoFocus
            />
            <p className="text-xs text-muted-foreground text-right">{reason.length}/1000</p>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" size="sm" onClick={handleCancel}>
              Отмена
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!reason.trim()}
            >
              Подтвердить перенос
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
