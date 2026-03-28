import type { Department, User } from '@/types'
import { formatUserDisplayName } from '@/lib/userName'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  departments: Department[]
  users: User[]
  canManageTeam: boolean | undefined
  departmentDrafts: Record<string, { parent_id: string; head_user_id: string }>
  handleDepartmentDraftChange: (departmentId: string, field: 'parent_id' | 'head_user_id', value: string) => void
  handleSaveDepartment: (department: Department) => void
  handleDeleteDepartment: (department: Department) => void
  subordinateTree: Record<string, User[]>
  usersById: Record<string, User>
  // useTeamDepartmentCreate props
  newDepartmentName: string
  setNewDepartmentName: (v: string) => void
  newDepartmentParentId: string
  setNewDepartmentParentId: (v: string) => void
  newDepartmentHeadId: string
  setNewDepartmentHeadId: (v: string) => void
  creatingDepartment: boolean
  handleCreateDepartment: (e: React.FormEvent) => void
}

export function TeamOrgSection({
  departments,
  users,
  canManageTeam,
  departmentDrafts,
  handleDepartmentDraftChange,
  handleSaveDepartment,
  handleDeleteDepartment,
  subordinateTree,
  usersById,
  newDepartmentName,
  setNewDepartmentName,
  newDepartmentParentId,
  setNewDepartmentParentId,
  newDepartmentHeadId,
  setNewDepartmentHeadId,
  creatingDepartment,
  handleCreateDepartment,
}: Props) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <h2 className="font-semibold">Управление оргструктурой</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Отделы</p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {departments.map((d) => (
              <div key={d.id} className="border rounded px-2 py-2 text-sm space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Руководитель: {formatUserDisplayName(usersById[d.head_user_id || '']) || 'не назначен'}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <select
                    value={departmentDrafts[d.id]?.parent_id ?? ''}
                    onChange={(e) => handleDepartmentDraftChange(d.id, 'parent_id', e.target.value)}
                    className="w-full border rounded px-2 py-1 bg-background text-xs"
                  >
                    <option value="">Без родительского отдела</option>
                    {departments.filter((x) => x.id !== d.id).map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </select>
                  <select
                    value={departmentDrafts[d.id]?.head_user_id ?? ''}
                    onChange={(e) => handleDepartmentDraftChange(d.id, 'head_user_id', e.target.value)}
                    className="w-full border rounded px-2 py-1 bg-background text-xs"
                  >
                    <option value="">Без руководителя</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{formatUserDisplayName(u)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-end gap-2">
                  {canManageTeam && (
                    <Button size="sm" variant="outline" onClick={() => handleSaveDepartment(d)}>
                      Сохранить
                    </Button>
                  )}
                  {canManageTeam && (
                    <Button size="sm" variant="ghost" onClick={() => handleDeleteDepartment(d)}>
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
        <form onSubmit={handleCreateDepartment} className="space-y-2 max-w-xl">
          <p className="text-sm font-medium">Создать отдел</p>
          <Input
            placeholder="Название отдела"
            value={newDepartmentName}
            onChange={(e) => setNewDepartmentName(e.target.value)}
            required
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <select
              value={newDepartmentParentId}
              onChange={(e) => setNewDepartmentParentId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              <option value="">Без родительского отдела</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select
              value={newDepartmentHeadId}
              onChange={(e) => setNewDepartmentHeadId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              <option value="">Без руководителя</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{formatUserDisplayName(u)}</option>
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
