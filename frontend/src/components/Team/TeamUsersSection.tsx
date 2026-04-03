import type { Department, User } from '@/types'
import { formatUserDisplayName } from '@/lib/userName'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { UserDraft } from '@/hooks/useTeamUsersAdminState'

interface InviteForm {
  first_name: string
  last_name: string
  middle_name: string
  email: string
  work_email: string
  password: string
  role: 'developer' | 'manager' | 'admin'
  visibility_scope: 'own_tasks_only' | 'department_scope' | 'full_scope'
  own_tasks_visibility_enabled: boolean
  position_title: string
  manager_id: string
  department_id: string
}

interface Props {
  users: User[]
  departments: Department[]
  loading: boolean
  canManageTeam: boolean | undefined
  canCreateSubordinates: boolean | undefined
  currentUser: User | null | undefined
  permissionDrafts: Record<string, UserDraft>
  nameDrafts: Record<string, { first_name: string; last_name: string; middle_name: string }>
  setNameDrafts: React.Dispatch<React.SetStateAction<Record<string, { first_name: string; last_name: string; middle_name: string }>>>
  tempPasswords: Record<string, string>
  busyUserId: string | null
  nameBusyId: string | null
  handleSaveName: (user: User) => void
  handleSavePermissions: (user: User) => void
  handleResetPassword: (user: User) => void
  handleDeactivate: (user: User) => void
  isNameChanged: (user: User) => boolean
  isPermissionChanged: (user: User) => boolean
  handlePermissionChange: (userId: string, field: keyof UserDraft, value: string | boolean) => void
  usersById: Record<string, User>
  // invite form props
  invite: InviteForm
  setInvite: React.Dispatch<React.SetStateAction<InviteForm>>
  inviting: boolean
  inviteSuccess: string
  inviteError: string
  handleInvite: (e: React.FormEvent) => void
}

export function TeamUsersSection({
  users,
  departments,
  loading,
  canManageTeam,
  canCreateSubordinates,
  currentUser,
  permissionDrafts,
  nameDrafts,
  setNameDrafts,
  tempPasswords,
  busyUserId,
  nameBusyId,
  handleSaveName,
  handleSavePermissions,
  handleResetPassword,
  handleDeactivate,
  isNameChanged,
  isPermissionChanged,
  handlePermissionChange,
  usersById,
  invite,
  setInvite,
  inviting,
  inviteSuccess,
  inviteError,
  handleInvite,
}: Props) {
  return (
    <>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <h2 className="font-semibold">Управление пользователями</h2>
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
                {(user.id === currentUser?.id || canManageTeam) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      className="text-xs border rounded px-2 py-1 bg-background w-28"
                      placeholder="Имя"
                      value={nameDrafts[user.id]?.first_name ?? ''}
                      onChange={(e) =>
                        setNameDrafts((prev) => ({
                          ...prev,
                          [user.id]: { ...prev[user.id], first_name: e.target.value },
                        }))
                      }
                    />
                    <input
                      className="text-xs border rounded px-2 py-1 bg-background w-28"
                      placeholder="Фамилия"
                      value={nameDrafts[user.id]?.last_name ?? ''}
                      onChange={(e) =>
                        setNameDrafts((prev) => ({
                          ...prev,
                          [user.id]: { ...prev[user.id], last_name: e.target.value },
                        }))
                      }
                    />
                    <input
                      className="text-xs border rounded px-2 py-1 bg-background w-28"
                      placeholder="Отчество"
                      value={nameDrafts[user.id]?.middle_name ?? ''}
                      onChange={(e) =>
                        setNameDrafts((prev) => ({
                          ...prev,
                          [user.id]: { ...prev[user.id], middle_name: e.target.value },
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSaveName(user)}
                      disabled={nameBusyId === user.id || !isNameChanged(user)}
                    >
                      Сохранить имя
                    </Button>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <select
                    value={permissionDrafts[user.id]?.role ?? user.role}
                    onChange={(e) => handlePermissionChange(user.id, 'role', e.target.value)}
                    className="border rounded px-2 py-1 bg-background"
                  >
                    <option value="developer">developer</option>
                    <option value="manager">manager</option>
                    {currentUser?.role === 'admin' && <option value="admin">admin</option>}
                  </select>
                  <select
                    value={permissionDrafts[user.id]?.visibility_scope ?? user.visibility_scope ?? 'department_scope'}
                    onChange={(e) => handlePermissionChange(user.id, 'visibility_scope', e.target.value)}
                    className="border rounded px-2 py-1 bg-background"
                  >
                    <option value="own_tasks_only">own_tasks_only</option>
                    <option value="department_scope">department_scope</option>
                    {currentUser?.role === 'admin' && <option value="full_scope">full_scope</option>}
                  </select>
                  <Input
                    type="email"
                    placeholder="corp@company.com"
                    value={permissionDrafts[user.id]?.work_email ?? ''}
                    onChange={(e) => handlePermissionChange(user.id, 'work_email', e.target.value)}
                    className="h-8"
                  />
                  <Input
                    placeholder="Должность"
                    value={permissionDrafts[user.id]?.position_title ?? ''}
                    onChange={(e) => handlePermissionChange(user.id, 'position_title', e.target.value)}
                    className="h-8"
                  />
                  <select
                    value={permissionDrafts[user.id]?.manager_id ?? ''}
                    onChange={(e) => handlePermissionChange(user.id, 'manager_id', e.target.value)}
                    className="border rounded px-2 py-1 bg-background"
                  >
                    <option value="">Без руководителя</option>
                    {users.filter((u) => u.id !== user.id).map((u) => (
                      <option key={u.id} value={u.id}>{formatUserDisplayName(u)}</option>
                    ))}
                  </select>
                  <select
                    value={permissionDrafts[user.id]?.department_id ?? ''}
                    onChange={(e) => handlePermissionChange(user.id, 'department_id', e.target.value)}
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
                        onCheckedChange={(checked) => handlePermissionChange(user.id, 'own_tasks_visibility_enabled', checked)}
                        disabled={!canCreateSubordinates || (currentUser?.role !== 'admin' && user.manager_id !== currentUser?.id)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                      <span>team</span>
                      <Switch
                        checked={permissionDrafts[user.id]?.can_manage_team ?? user.can_manage_team}
                        onCheckedChange={(checked) => handlePermissionChange(user.id, 'can_manage_team', checked)}
                        disabled={currentUser?.role !== 'admin'}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                      <span>delete</span>
                      <Switch
                        checked={permissionDrafts[user.id]?.can_delete ?? user.can_delete}
                        onCheckedChange={(checked) => handlePermissionChange(user.id, 'can_delete', checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                      <span>import</span>
                      <Switch
                        checked={permissionDrafts[user.id]?.can_import ?? user.can_import}
                        onCheckedChange={(checked) => handlePermissionChange(user.id, 'can_import', checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                      <span>bulk</span>
                      <Switch
                        checked={permissionDrafts[user.id]?.can_bulk_edit ?? user.can_bulk_edit}
                        onCheckedChange={(checked) => handlePermissionChange(user.id, 'can_bulk_edit', checked)}
                      />
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSavePermissions(user)}
                  disabled={busyUserId === user.id || !isPermissionChanged(user)}
                >
                  Сохранить карточку
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleResetPassword(user)}
                  disabled={busyUserId === user.id || user.id === currentUser?.id || !canCreateSubordinates}
                >
                  Сброс пароля
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleDeactivate(user)}
                  disabled={busyUserId === user.id || user.id === currentUser?.id || !canCreateSubordinates}
                >
                  Удалить сотрудника
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h2 className="font-semibold mb-1">Добавить сотрудника</h2>
        <p className="text-sm text-muted-foreground mb-4">Создает новую учетную запись подчиненного.</p>
        <form onSubmit={handleInvite} className="space-y-4 max-w-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Имя</Label>
              <Input
                placeholder="Иван"
                value={invite.first_name}
                onChange={(e) => setInvite((f) => ({ ...f, first_name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Фамилия</Label>
              <Input
                placeholder="Петров"
                value={invite.last_name}
                onChange={(e) => setInvite((f) => ({ ...f, last_name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Отчество</Label>
              <Input
                placeholder="Иванович"
                value={invite.middle_name}
                onChange={(e) => setInvite((f) => ({ ...f, middle_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="ivan@example.com"
                value={invite.email}
                onChange={(e) => setInvite((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Корпоративный email</Label>
              <Input
                type="email"
                placeholder="ivan@company.com"
                value={invite.work_email}
                onChange={(e) => setInvite((f) => ({ ...f, work_email: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Должность</Label>
              <Input
                placeholder="Начальник отдела / ГИП / ..."
                value={invite.position_title}
                onChange={(e) => setInvite((f) => ({ ...f, position_title: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Руководитель</Label>
              <select
                value={invite.manager_id}
                onChange={(e) => setInvite((f) => ({ ...f, manager_id: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm bg-background"
              >
                <option value="">Не назначен</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{formatUserDisplayName(u)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Отдел</Label>
              <select
                value={invite.department_id}
                onChange={(e) => setInvite((f) => ({ ...f, department_id: e.target.value }))}
                className="w-full border rounded px-3 py-2 text-sm bg-background"
              >
                <option value="">Без отдела</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Роль</Label>
              <select
                value={invite.role}
                onChange={(e) =>
                  setInvite((f) => ({
                    ...f,
                    role: e.target.value as 'developer' | 'manager' | 'admin',
                    visibility_scope:
                      e.target.value === 'admin'
                        ? 'full_scope'
                        : e.target.value === 'manager'
                          ? 'department_scope'
                          : 'own_tasks_only',
                  }))
                }
                className="w-full border rounded px-3 py-2 text-sm bg-background"
              >
                <option value="developer">Developer</option>
                <option value="manager">Manager</option>
                {currentUser?.role === 'admin' && <option value="admin">Admin</option>}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Видимость</Label>
              <select
                value={invite.visibility_scope}
                onChange={(e) =>
                  setInvite((f) => ({
                    ...f,
                    visibility_scope: e.target.value as 'own_tasks_only' | 'department_scope' | 'full_scope',
                  }))
                }
                className="w-full border rounded px-3 py-2 text-sm bg-background"
              >
                <option value="own_tasks_only">own_tasks_only</option>
                <option value="department_scope">department_scope</option>
                {currentUser?.role === 'admin' && <option value="full_scope">full_scope</option>}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Фильтр "только свои задачи"</Label>
              <label className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <span>{invite.own_tasks_visibility_enabled ? 'Включен' : 'Выключен'}</span>
                <Switch
                  checked={invite.own_tasks_visibility_enabled}
                  onCheckedChange={(checked) => setInvite((f) => ({ ...f, own_tasks_visibility_enabled: checked }))}
                />
              </label>
            </div>
            <div className="space-y-1">
              <Label>Временный пароль</Label>
              <Input
                type="text"
                placeholder="Не короче 6 символов"
                value={invite.password}
                onChange={(e) => setInvite((f) => ({ ...f, password: e.target.value }))}
                required
                minLength={6}
              />
            </div>
          </div>
          <Button type="submit" disabled={inviting || !canCreateSubordinates}>
            {inviting ? 'Создание...' : 'Создать аккаунт'}
          </Button>
          {!canCreateSubordinates && (
            <p className="text-xs text-muted-foreground">Создавать подчиненных могут только менеджеры/администраторы.</p>
          )}
          {inviteSuccess && <p className="text-sm text-green-600">{inviteSuccess}</p>}
          {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
        </form>
      </div>
    </>
  )
}
