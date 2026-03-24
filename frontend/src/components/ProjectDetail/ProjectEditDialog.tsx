import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CustomFieldsManager } from '@/components/CustomFieldsManager'
import { formatUserDisplayName } from '@/lib/userName'
import type { User, ProjectFile } from '@/types'

const PROJECT_STATUS_OPTIONS = [
  { value: 'planning', label: 'Планирование' },
  { value: 'tz', label: 'ТЗ' },
  { value: 'active', label: 'Активный' },
  { value: 'testing', label: 'Тестирование' },
  { value: 'on_hold', label: 'Пауза' },
  { value: 'completed', label: 'Завершён' },
]

export type ProjectEditFormState = {
  name: string
  description: string
  status: string
  priority: string
  control_ski: boolean
  planning_mode: string
  strict_no_past_start_date: boolean
  strict_no_past_end_date: boolean
  strict_child_within_parent_dates: boolean
  launch_basis_text: string
  launch_basis_file_id: string
  start_date: string
  end_date: string
  owner_id: string
  completion_checklist: { id: string; label: string; done: boolean }[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  editForm: ProjectEditFormState
  setEditForm: React.Dispatch<React.SetStateAction<ProjectEditFormState>>
  onSubmit: (e: React.FormEvent) => void
  isPending: boolean
  users: User[]
  files: ProjectFile[]
  projectId: string
  canManage: boolean
  canTransferOwnership: boolean
}

export function ProjectEditDialog({
  open,
  onOpenChange,
  editForm,
  setEditForm,
  onSubmit,
  isPending,
  users,
  files,
  projectId,
  canManage,
  canTransferOwnership,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[88vh]">
        <DialogHeader>
          <DialogTitle>Редактировать проект</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto max-h-[72vh] pr-1">
          <div className="space-y-1">
            <Label>Название</Label>
            <Input
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Описание</Label>
            <Input
              value={editForm.description}
              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Статус</Label>
              <select
                value={editForm.status}
                onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full border rounded px-2 py-2 bg-background text-sm"
              >
                {PROJECT_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Режим планирования</Label>
              <select
                value={editForm.planning_mode}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    planning_mode: e.target.value as 'flexible' | 'strict',
                  }))
                }
                className="w-full border rounded px-2 py-2 bg-background text-sm"
              >
                <option value="flexible">Гибкий</option>
                <option value="strict">Строгий</option>
              </select>
            </div>

            <div className="space-y-1">
              <Label>Приоритет</Label>
              <div className="flex items-center gap-3">
                <select
                  value={editForm.control_ski ? 'critical' : editForm.priority}
                  onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}
                  className="w-full border rounded px-2 py-2 bg-background text-sm"
                  disabled={editForm.control_ski}
                >
                  <option value="low">Низкий</option>
                  <option value="medium">Средний</option>
                  <option value="high">Высокий</option>
                  <option value="critical">Критический</option>
                </select>
                <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                  <span>Контроль СКИ</span>
                  <Switch
                    checked={editForm.control_ski}
                    onCheckedChange={(checked) =>
                      setEditForm((f) => ({
                        ...f,
                        control_ski: checked,
                        priority: checked ? 'critical' : f.priority,
                      }))
                    }
                  />
                </label>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Ответственный</Label>
              <select
                value={editForm.owner_id}
                onChange={(e) => setEditForm((f) => ({ ...f, owner_id: e.target.value }))}
                className="w-full border rounded px-2 py-2 bg-background text-sm"
                disabled={!canTransferOwnership}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {formatUserDisplayName(u)} ({u.role})
                  </option>
                ))}
              </select>
              {!canTransferOwnership && (
                <p className="text-xs text-muted-foreground mt-1">
                  Только владелец проекта или администратор может менять ответственного.
                </p>
              )}
            </div>
          </div>
          {editForm.planning_mode === 'strict' && (
            <div className="rounded border bg-muted/20 p-3 space-y-2 lg:col-span-2">
              <p className="text-sm font-medium">Правила строгого режима</p>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Запрет даты начала в прошлом</span>
                <Switch
                  checked={editForm.strict_no_past_start_date}
                  onCheckedChange={(checked) =>
                    setEditForm((f) => ({ ...f, strict_no_past_start_date: checked }))
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Запрет дедлайна в прошлом</span>
                <Switch
                  checked={editForm.strict_no_past_end_date}
                  onCheckedChange={(checked) =>
                    setEditForm((f) => ({ ...f, strict_no_past_end_date: checked }))
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Дочерняя задача в диапазоне дат родителя</span>
                <Switch
                  checked={editForm.strict_child_within_parent_dates}
                  onCheckedChange={(checked) =>
                    setEditForm((f) => ({ ...f, strict_child_within_parent_dates: checked }))
                  }
                />
              </label>
            </div>
          )}

          <div className="space-y-1 lg:col-span-2">
            <Label>Основание запуска</Label>
            <Input
              value={editForm.launch_basis_text}
              onChange={(e) => setEditForm((f) => ({ ...f, launch_basis_text: e.target.value }))}
              placeholder="Напр.: Приказ #111222333 24.02.2026"
            />
          </div>

          <div className="space-y-1 lg:col-span-2">
            <Label>Файл основания запуска</Label>
            <select
              value={editForm.launch_basis_file_id}
              onChange={(e) => setEditForm((f) => ({ ...f, launch_basis_file_id: e.target.value }))}
              className="w-full border rounded px-2 py-2 bg-background text-sm"
            >
              <option value="">—</option>
              {files.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.filename}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Дата начала</Label>
              <Input
                type="date"
                value={editForm.start_date}
                onChange={(e) => setEditForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Дата окончания</Label>
              <Input
                type="date"
                value={editForm.end_date}
                onChange={(e) => setEditForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2 rounded-lg border p-3 lg:col-span-2">
            <Label className="text-sm font-semibold">Definition of Done (обязательный чеклист)</Label>
            <div className="space-y-2">
              {editForm.completion_checklist.map((item) => (
                <label key={item.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        completion_checklist: prev.completion_checklist.map((current) =>
                          current.id === item.id ? { ...current, done: e.target.checked } : current
                        ),
                      }))
                    }
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
            {editForm.status === 'completed' &&
              editForm.completion_checklist.some((i) => !i.done) && (
                <p className="text-xs text-red-600">
                  Чтобы завершить проект, отметьте все пункты чеклиста.
                </p>
              )}
          </div>
          <div className="lg:col-span-2 border-t pt-3">
            <CustomFieldsManager projectId={projectId} canManage={canManage} />
          </div>
          <Button type="submit" className="w-full lg:col-span-2" disabled={isPending}>
            {isPending ? 'Сохранение...' : 'Сохранить изменения'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
