import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PROJECT_STATUS_OPTIONS } from '@/lib/domainMeta'
import { formatUserDisplayName } from '@/lib/userName'
import type { Project, ProjectFile, User } from '@/types'

export interface ProjectEditFormState {
  name: string
  description: string
  status: string
  priority: string
  control_ski: boolean
  planning_mode: 'flexible' | 'strict'
  strict_no_past_start_date: boolean
  strict_no_past_end_date: boolean
  strict_child_within_parent_dates: boolean
  launch_basis_text: string
  launch_basis_file_id: string
  start_date: string
  end_date: string
  owner_id: string
  completion_checklist: Array<{ id: string; label: string; done: boolean }>
}

interface ProjectEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  canRenameProject: boolean
  canManage: boolean
  canTransferOwnership: boolean
  editForm: ProjectEditFormState
  setEditForm: Dispatch<SetStateAction<ProjectEditFormState>>
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  users: User[]
  project: Project
  files: ProjectFile[]
  projectProgress: number
  progressStats: {
    completedCount: number
    zeroProgressCount: number
    totalCount: number
  }
  isPending: boolean
}

export function ProjectEditDialog({
  open,
  onOpenChange,
  canRenameProject,
  canManage,
  canTransferOwnership,
  editForm,
  setEditForm,
  onSubmit,
  users,
  project,
  files,
  projectProgress,
  progressStats,
  isPending,
}: ProjectEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!canRenameProject}>
          <Pencil className="w-4 h-4 mr-1" />
          Редактировать
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[88vh]">
        <DialogHeader>
          <DialogTitle>Редактировать проект</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto max-h-[72vh] pr-1">
          {!canManage && (
            <div className="lg:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              У вас открыт упрощённый режим: можно корректировать только название проекта. Остальные поля доступны владельцу проекта, менеджеру проекта или администратору.
            </div>
          )}
          <div className="lg:col-span-2 rounded-xl border bg-muted/30 p-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Статус</p>
                <p className="text-sm font-semibold">
                  {PROJECT_STATUS_OPTIONS.find((item) => item.value === editForm.status)?.label ?? editForm.status}
                </p>
              </div>
              <div className="rounded-lg border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Дедлайн</p>
                <p className="text-sm font-semibold">
                  {editForm.end_date ? new Date(editForm.end_date).toLocaleDateString('ru-RU') : 'Не задан'}
                </p>
              </div>
              <div className="rounded-lg border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Прогресс проекта</p>
                <p className="text-sm font-semibold">{projectProgress}%</p>
              </div>
              <div className="rounded-lg border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Задачи</p>
                <p className="text-sm font-semibold">
                  {progressStats.completedCount} / {progressStats.totalCount} выполнено
                </p>
              </div>
              <div className="rounded-lg border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Ответственный</p>
                <p className="text-sm font-semibold">
                  {formatUserDisplayName(users.find((u) => u.id === editForm.owner_id) ?? project.owner)}
                </p>
              </div>
            </div>
          </div>
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
              disabled={!canManage}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Статус</Label>
              <select
                value={editForm.status}
                onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full border rounded px-2 py-2 bg-background text-sm"
                disabled={!canManage}
              >
                {PROJECT_STATUS_OPTIONS.map((statusItem) => (
                  <option key={statusItem.value} value={statusItem.value}>
                    {statusItem.label}
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
                disabled={!canManage}
              >
                <option value="flexible">Гибкий</option>
                <option value="strict">Строгий</option>
              </select>
              <div className="mt-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">Как выбрать режим</p>
                  <Link
                    to="/help#planning-modes"
                    className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                  >
                    Подробнее
                  </Link>
                </div>
                <div className="mt-2 space-y-1.5">
                  <p><span className="font-medium text-foreground">Гибкий</span> — для живых рабочих списков без жёсткой валидации.</p>
                  <p><span className="font-medium text-foreground">Строгий</span> — для управляемых проектов с правилами дат и зависимостей.</p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Приоритет</Label>
              <div className="flex items-center gap-3">
                <select
                  value={editForm.control_ski ? 'critical' : editForm.priority}
                  onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}
                  className="w-full border rounded px-2 py-2 bg-background text-sm"
                  disabled={!canManage || editForm.control_ski}
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
                    disabled={!canManage}
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
                disabled={!canTransferOwnership || !canManage}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {formatUserDisplayName(user)} ({user.role})
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Правила строгого режима</p>
                <Link
                  to="/help#planning-modes"
                  className="text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                >
                  Как это работает
                </Link>
              </div>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Запрет даты начала в прошлом</span>
                <Switch
                  checked={editForm.strict_no_past_start_date}
                  onCheckedChange={(checked) =>
                    setEditForm((f) => ({ ...f, strict_no_past_start_date: checked }))
                  }
                  disabled={!canManage}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Запрет дедлайна в прошлом</span>
                <Switch
                  checked={editForm.strict_no_past_end_date}
                  onCheckedChange={(checked) =>
                    setEditForm((f) => ({ ...f, strict_no_past_end_date: checked }))
                  }
                  disabled={!canManage}
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm">
                <span>Дочерняя задача в диапазоне дат родителя</span>
                <Switch
                  checked={editForm.strict_child_within_parent_dates}
                  onCheckedChange={(checked) =>
                    setEditForm((f) => ({ ...f, strict_child_within_parent_dates: checked }))
                  }
                  disabled={!canManage}
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
              disabled={!canManage}
            />
          </div>

          <div className="space-y-1 lg:col-span-2">
            <Label>Файл основания запуска</Label>
            <select
              value={editForm.launch_basis_file_id}
              onChange={(e) => setEditForm((f) => ({ ...f, launch_basis_file_id: e.target.value }))}
              className="w-full border rounded px-2 py-2 bg-background text-sm"
              disabled={!canManage}
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
                disabled={!canManage}
              />
            </div>
            <div className="space-y-1">
              <Label>Дата окончания</Label>
              <Input
                type="date"
                value={editForm.end_date}
                onChange={(e) => setEditForm((f) => ({ ...f, end_date: e.target.value }))}
                disabled={!canManage}
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
                    disabled={!canManage}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
            {editForm.status === 'completed' &&
              editForm.completion_checklist.some((item) => !item.done) && (
                <p className="text-xs text-red-600">
                  Чтобы завершить проект, отметьте все пункты чеклиста.
                </p>
              )}
          </div>
          <Button type="submit" className="w-full lg:col-span-2" disabled={isPending}>
            {isPending ? 'Сохранение...' : 'Сохранить изменения'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
