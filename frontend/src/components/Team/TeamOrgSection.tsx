import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Department, User } from '@/types'
import { formatUserDisplayName } from '@/lib/userName'
import type { FormEvent } from 'react'

type TeamOrgSectionProps = {
  departments: Department[]
  users: User[]
  usersById: Record<string, User>
  subordinateTree: Record<string, User[]>
  departmentDrafts: Record<string, { parent_id: string; head_user_id: string }>
  canManageTeam: boolean
  creatingDepartment: boolean
  newDepartmentName: string
  newDepartmentParentId: string
  newDepartmentHeadId: string
  onDepartmentDraftChange: (departmentId: string, field: 'parent_id' | 'head_user_id', value: string) => void
  onSaveDepartment: (department: Department) => void
  onDeleteDepartment: (department: Department) => void
  onCreateDepartment: (e: FormEvent) => void
  onNewDepartmentNameChange: (value: string) => void
  onNewDepartmentParentIdChange: (value: string) => void
  onNewDepartmentHeadIdChange: (value: string) => void
}

export function TeamOrgSection({
  departments,
  users,
  usersById,
  subordinateTree,
  departmentDrafts,
  canManageTeam,
  creatingDepartment,
  newDepartmentName,
  newDepartmentParentId,
  newDepartmentHeadId,
  onDepartmentDraftChange,
  onSaveDepartment,
  onDeleteDepartment,
  onCreateDepartment,
  onNewDepartmentNameChange,
  onNewDepartmentParentIdChange,
  onNewDepartmentHeadIdChange,
}: TeamOrgSectionProps) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <h2 className="font-semibold">Управление оргструктурой</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Отделы</p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {departments.map((department) => (
              <div key={department.id} className="border rounded px-2 py-2 text-sm space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{department.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Руководитель: {formatUserDisplayName(usersById[department.head_user_id || '']) || 'не назначен'}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <select
                    value={departmentDrafts[department.id]?.parent_id ?? ''}
                    onChange={(e) => onDepartmentDraftChange(department.id, 'parent_id', e.target.value)}
                    className="w-full border rounded px-2 py-1 bg-background text-xs"
                  >
                    <option value="">Без родительского отдела</option>
                    {departments.filter((item) => item.id !== department.id).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  <select
                    value={departmentDrafts[department.id]?.head_user_id ?? ''}
                    onChange={(e) => onDepartmentDraftChange(department.id, 'head_user_id', e.target.value)}
                    className="w-full border rounded px-2 py-1 bg-background text-xs"
                  >
                    <option value="">Без руководителя</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>{formatUserDisplayName(user)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-end gap-2">
                  {canManageTeam && (
                    <Button size="sm" variant="outline" onClick={() => onSaveDepartment(department)}>
                      Сохранить
                    </Button>
                  )}
                  {canManageTeam && (
                    <Button size="sm" variant="ghost" onClick={() => onDeleteDepartment(department)}>
                      Удалить
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {departments.length === 0 && <p className="text-xs text-muted-foreground">Отделов пока нет.</p>}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Иерархия сотрудников</p>
          <div className="border rounded p-2 max-h-72 overflow-y-auto text-sm space-y-1">
            {(subordinateTree.root || []).map((rootUser) => (
              <div key={rootUser.id}>
                <p className="font-medium">{formatUserDisplayName(rootUser)} ({rootUser.role})</p>
                {(subordinateTree[rootUser.id] || []).map((child) => (
                  <p key={child.id} className="ml-4 text-xs text-muted-foreground">
                    ↳ {formatUserDisplayName(child)} ({child.position_title || child.role})
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {canManageTeam && (
        <form onSubmit={onCreateDepartment} className="space-y-2 max-w-xl">
          <p className="text-sm font-medium">Создать отдел</p>
          <Input
            placeholder="Название отдела"
            value={newDepartmentName}
            onChange={(e) => onNewDepartmentNameChange(e.target.value)}
            required
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <select
              value={newDepartmentParentId}
              onChange={(e) => onNewDepartmentParentIdChange(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              <option value="">Без родительского отдела</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
            <select
              value={newDepartmentHeadId}
              onChange={(e) => onNewDepartmentHeadIdChange(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              <option value="">Без руководителя</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{formatUserDisplayName(user)}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={creatingDepartment}>
            {creatingDepartment ? 'Создание...' : 'Создать отдел'}
          </Button>
        </form>
      )}
    </div>
  )
}
