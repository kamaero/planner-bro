import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { formatUserDisplayName } from '@/lib/userName'
import type { User, Department } from '@/types'
import { Link } from 'react-router-dom'

type UserDraft = Pick<
  User,
  'role' | 'visibility_scope' | 'own_tasks_visibility_enabled' | 'work_email' | 'position_title' | 'manager_id' | 'department_id' | 'can_manage_team' | 'can_delete' | 'can_import' | 'can_bulk_edit'
>

type NameField = 'first_name' | 'middle_name' | 'last_name'

type TeamUsersManagementSectionProps = {
  loading: boolean
  users: User[]
  departments: Department[]
  usersById: Record<string, User>
  permissionDrafts: Record<string, UserDraft>
  tempPasswords: Record<string, string>
  nameDrafts: Record<string, { first_name: string; middle_name: string; last_name: string }>
  currentUserId?: string
  currentUserRole?: User['role']
  canManageTeam: boolean
  canCreateSubordinates: boolean
  busyUserId: string | null
  nameBusyId: string | null
  getRoleSummary: (value?: User['role']) => string
  getVisibilitySummary: (value?: User['visibility_scope']) => string
  isNameChanged: (user: User) => boolean
  isPermissionChanged: (user: User) => boolean
  onNameDraftChange: (userId: string, field: NameField, value: string) => void
  onSaveName: (user: User) => void
  onPermissionChange: (userId: string, field: keyof UserDraft, value: string | boolean) => void
  onSavePermissions: (user: User) => void
  onResetPassword: (user: User) => void
  onDeactivate: (user: User) => void
}

export function TeamUsersManagementSection({
  loading,
  users,
  departments,
  usersById,
  permissionDrafts,
  tempPasswords,
  nameDrafts,
  currentUserId,
  currentUserRole,
  canManageTeam,
  canCreateSubordinates,
  busyUserId,
  nameBusyId,
  getRoleSummary,
  getVisibilitySummary,
  isNameChanged,
  isPermissionChanged,
  onNameDraftChange,
  onSaveName,
  onPermissionChange,
  onSavePermissions,
  onResetPassword,
  onDeactivate,
}: TeamUsersManagementSectionProps) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Управление пользователями</h2>
          <p className="text-sm text-muted-foreground">
            Здесь настраиваются роль, видимость и точечные рабочие права пользователя.
          </p>
        </div>
        <Link
          to="/help#roles"
          className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          Подробнее о правах и видимости
        </Link>
      </div>
      <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground md:grid-cols-3">
        <p><span className="font-medium text-foreground">Role</span> задаёт базовый уровень полномочий.</p>
        <p><span className="font-medium text-foreground">Visibility</span> определяет, какой контур проектов и задач человек видит.</p>
        <p><span className="font-medium text-foreground">own-only</span> включает персональный режим `Мои задачи` как основной.</p>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
      {!loading && users.length === 0 && (
        <p className="text-sm text-muted-foreground">Активных аккаунтов пока нет.</p>
      )}
      <div className="space-y-2">
        {users.map((user) => (
          <div key={user.id} className="rounded-lg border px-3 py-3 flex flex-col gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{formatUserDisplayName(user)} — {user.email}</p>
              <p className="text-xs text-muted-foreground">Корпоративная почта: {user.work_email || 'не указана'}</p>
              <p className="text-xs text-muted-foreground">Должность: {permissionDrafts[user.id]?.position_title || 'не указана'}</p>
              <p className="text-xs text-muted-foreground">
                Руководитель: {formatUserDisplayName(usersById[permissionDrafts[user.id]?.manager_id || '']) || 'не назначен'}
              </p>
              <p className="text-xs text-muted-foreground">
                Отдел: {departments.find((d) => d.id === (permissionDrafts[user.id]?.department_id || ''))?.name || 'не назначен'}
              </p>
              <p className="text-xs text-muted-foreground">
                Видимость: {permissionDrafts[user.id]?.visibility_scope || 'department_scope'}
              </p>
              <p className="text-xs text-muted-foreground">
                Фильтр "только свои задачи": {(permissionDrafts[user.id]?.own_tasks_visibility_enabled ?? true) ? 'включен' : 'выключен'}
              </p>
              {tempPasswords[user.id] && (
                <p className="text-xs text-orange-600 mt-1">Временный пароль: {tempPasswords[user.id]}</p>
              )}
              {(user.id === currentUserId || canManageTeam) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    className="text-xs border rounded px-2 py-1 bg-background w-28"
                    placeholder="Имя"
                    value={nameDrafts[user.id]?.first_name ?? ''}
                    onChange={(e) => onNameDraftChange(user.id, 'first_name', e.target.value)}
                  />
                  <input
                    className="text-xs border rounded px-2 py-1 bg-background w-28"
                    placeholder="Фамилия"
                    value={nameDrafts[user.id]?.last_name ?? ''}
                    onChange={(e) => onNameDraftChange(user.id, 'last_name', e.target.value)}
                  />
                  <input
                    className="text-xs border rounded px-2 py-1 bg-background w-28"
                    placeholder="Отчество"
                    value={nameDrafts[user.id]?.middle_name ?? ''}
                    onChange={(e) => onNameDraftChange(user.id, 'middle_name', e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSaveName(user)}
                    disabled={nameBusyId === user.id || !isNameChanged(user)}
                  >
                    Сохранить имя
                  </Button>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <div className="min-w-[220px] rounded-lg border bg-muted/20 px-2 py-2">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Role</p>
                  <select
                    value={permissionDrafts[user.id]?.role ?? user.role}
                    onChange={(e) => onPermissionChange(user.id, 'role', e.target.value)}
                    className="w-full border rounded px-2 py-1 bg-background"
                  >
                    <option value="developer">developer</option>
                    <option value="manager">manager</option>
                    {currentUserRole === 'admin' && <option value="admin">admin</option>}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {getRoleSummary((permissionDrafts[user.id]?.role ?? user.role) as User['role'])}
                  </p>
                </div>
                <div className="min-w-[240px] rounded-lg border bg-muted/20 px-2 py-2">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Visibility</p>
                  <select
                    value={permissionDrafts[user.id]?.visibility_scope ?? user.visibility_scope ?? 'department_scope'}
                    onChange={(e) => onPermissionChange(user.id, 'visibility_scope', e.target.value)}
                    className="w-full border rounded px-2 py-1 bg-background"
                  >
                    <option value="own_tasks_only">own_tasks_only</option>
                    <option value="department_scope">department_scope</option>
                    {currentUserRole === 'admin' && <option value="full_scope">full_scope</option>}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {getVisibilitySummary((permissionDrafts[user.id]?.visibility_scope ?? user.visibility_scope ?? 'department_scope') as User['visibility_scope'])}
                  </p>
                </div>
                <Input
                  type="email"
                  placeholder="corp@company.com"
                  value={permissionDrafts[user.id]?.work_email ?? ''}
                  onChange={(e) => onPermissionChange(user.id, 'work_email', e.target.value)}
                  className="h-8"
                />
                <Input
                  placeholder="Должность"
                  value={permissionDrafts[user.id]?.position_title ?? ''}
                  onChange={(e) => onPermissionChange(user.id, 'position_title', e.target.value)}
                  className="h-8"
                />
                <select
                  value={permissionDrafts[user.id]?.manager_id ?? ''}
                  onChange={(e) => onPermissionChange(user.id, 'manager_id', e.target.value)}
                  className="border rounded px-2 py-1 bg-background"
                >
                  <option value="">Без руководителя</option>
                  {users.filter((u) => u.id !== user.id).map((u) => (
                    <option key={u.id} value={u.id}>{formatUserDisplayName(u)}</option>
                  ))}
                </select>
                <select
                  value={permissionDrafts[user.id]?.department_id ?? ''}
                  onChange={(e) => onPermissionChange(user.id, 'department_id', e.target.value)}
                  className="border rounded px-2 py-1 bg-background"
                >
                  <option value="">Без отдела</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <label className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                    <span>own-only</span>
                    <Switch
                      checked={permissionDrafts[user.id]?.own_tasks_visibility_enabled ?? true}
                      onCheckedChange={(checked) => onPermissionChange(user.id, 'own_tasks_visibility_enabled', checked)}
                      disabled={!canCreateSubordinates || (currentUserRole !== 'admin' && user.manager_id !== currentUserId)}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                    <span>team</span>
                    <Switch
                      checked={permissionDrafts[user.id]?.can_manage_team ?? user.can_manage_team}
                      onCheckedChange={(checked) => onPermissionChange(user.id, 'can_manage_team', checked)}
                      disabled={currentUserRole !== 'admin'}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                    <span>delete</span>
                    <Switch
                      checked={permissionDrafts[user.id]?.can_delete ?? user.can_delete}
                      onCheckedChange={(checked) => onPermissionChange(user.id, 'can_delete', checked)}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                    <span>import</span>
                    <Switch
                      checked={permissionDrafts[user.id]?.can_import ?? user.can_import}
                      onCheckedChange={(checked) => onPermissionChange(user.id, 'can_import', checked)}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                    <span>bulk</span>
                    <Switch
                      checked={permissionDrafts[user.id]?.can_bulk_edit ?? user.can_bulk_edit}
                      onCheckedChange={(checked) => onPermissionChange(user.id, 'can_bulk_edit', checked)}
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSavePermissions(user)}
                disabled={busyUserId === user.id || !isPermissionChanged(user)}
              >
                Сохранить карточку
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onResetPassword(user)}
                disabled={busyUserId === user.id || user.id === currentUserId || !canCreateSubordinates}
              >
                Сброс пароля
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onDeactivate(user)}
                disabled={busyUserId === user.id || user.id === currentUserId || !canCreateSubordinates}
              >
                Удалить сотрудника
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
