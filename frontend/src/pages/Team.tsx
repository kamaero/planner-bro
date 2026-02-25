import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { User } from '@/types'

export function Team() {
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({})
  const [permissionDrafts, setPermissionDrafts] = useState<
    Record<string, Pick<User, 'role' | 'can_manage_team' | 'can_delete' | 'can_import' | 'can_bulk_edit'>>
  >({})

  const [invite, setInvite] = useState({ name: '', email: '', role: 'developer', password: '' })
  const [inviting, setInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [inviteError, setInviteError] = useState('')

  const canManageTeam = currentUser?.role === 'admin' || currentUser?.can_manage_team

  const loadUsers = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.listUsers()
      setUsers(data)
      const drafts: Record<string, Pick<User, 'role' | 'can_manage_team' | 'can_delete' | 'can_import' | 'can_bulk_edit'>> = {}
      data.forEach((user: User) => {
        drafts[user.id] = {
          role: user.role,
          can_manage_team: user.can_manage_team,
          can_delete: user.can_delete,
          can_import: user.can_import,
          can_bulk_edit: user.can_bulk_edit,
        }
      })
      setPermissionDrafts(drafts)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось загрузить список команды')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setInviteError('')
    setInviteSuccess('')
    try {
      await api.createUser({
        name: invite.name,
        email: invite.email,
        password: invite.password,
        role: invite.role,
      })
      setInviteSuccess(`Аккаунт создан: ${invite.email}`)
      setInvite({ name: '', email: '', role: 'developer', password: '' })
      await loadUsers()
    } catch (err: any) {
      setInviteError(err?.response?.data?.detail ?? 'Не удалось создать аккаунт')
    } finally {
      setInviting(false)
    }
  }

  const handleResetPassword = async (user: User) => {
    if (!canManageTeam) return
    setBusyUserId(user.id)
    setError('')
    try {
      const data = await api.resetUserPassword(user.id)
      setTempPasswords((prev) => ({ ...prev, [user.id]: data.temporary_password }))
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось сбросить пароль')
    } finally {
      setBusyUserId(null)
    }
  }

  const handleDeactivate = async (user: User) => {
    if (!canManageTeam) return
    if (!window.confirm(`Отключить сотрудника ${user.name}?`)) return
    setBusyUserId(user.id)
    setError('')
    try {
      await api.deactivateUser(user.id)
      setUsers((prev) => prev.filter((u) => u.id !== user.id))
      setTempPasswords((prev) => {
        const next = { ...prev }
        delete next[user.id]
        return next
      })
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось отключить сотрудника')
    } finally {
      setBusyUserId(null)
    }
  }

  const handlePermissionChange = (
    userId: string,
    field: 'role' | 'can_manage_team' | 'can_delete' | 'can_import' | 'can_bulk_edit',
    value: string | boolean
  ) => {
    setPermissionDrafts((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] ?? {
          role: 'developer',
          can_manage_team: false,
          can_delete: false,
          can_import: false,
          can_bulk_edit: false,
        }),
        [field]: value,
      } as Pick<User, 'role' | 'can_manage_team' | 'can_delete' | 'can_import' | 'can_bulk_edit'>,
    }))
  }

  const isPermissionChanged = (user: User) => {
    const draft = permissionDrafts[user.id]
    if (!draft) return false
    return (
      draft.role !== user.role ||
      draft.can_manage_team !== user.can_manage_team ||
      draft.can_delete !== user.can_delete ||
      draft.can_import !== user.can_import ||
      draft.can_bulk_edit !== user.can_bulk_edit
    )
  }

  const handleSavePermissions = async (user: User) => {
    if (!canManageTeam) return
    const draft = permissionDrafts[user.id]
    if (!draft) return
    setBusyUserId(user.id)
    setError('')
    try {
      const updated = await api.updateUserPermissions(user.id, draft)
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)))
      setPermissionDrafts((prev) => ({
        ...prev,
        [user.id]: {
          role: updated.role,
          can_manage_team: updated.can_manage_team,
          can_delete: updated.can_delete,
          can_import: updated.can_import,
          can_bulk_edit: updated.can_bulk_edit,
        },
      }))
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось обновить права сотрудника')
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Команда</h1>
      <p className="text-sm text-muted-foreground">
        Все сотрудники видят все проекты. Изменения доступны назначенным участникам проекта/задач.
      </p>

      <div className="rounded-xl border bg-card p-4 space-y-3">
        <h2 className="font-semibold">Активные учетные записи</h2>
        {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && users.length === 0 && (
          <p className="text-sm text-muted-foreground">Активных аккаунтов пока нет.</p>
        )}
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="rounded-lg border px-3 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {user.name} - {user.email}
                </p>
                <p className="text-xs text-muted-foreground">
                  Роль: {permissionDrafts[user.id]?.role ?? user.role}
                </p>
                {tempPasswords[user.id] && (
                  <p className="text-xs text-orange-600 mt-1">
                    Временный пароль: {tempPasswords[user.id]}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <select
                    value={permissionDrafts[user.id]?.role ?? user.role}
                    onChange={(e) => handlePermissionChange(user.id, 'role', e.target.value)}
                    className="border rounded px-2 py-1 bg-background"
                    disabled={
                      !canManageTeam ||
                      busyUserId === user.id ||
                      (currentUser?.role !== 'admin' && user.role === 'admin')
                    }
                  >
                    <option value="developer">developer</option>
                    <option value="manager">manager</option>
                    {currentUser?.role === 'admin' && <option value="admin">admin</option>}
                  </select>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={permissionDrafts[user.id]?.can_manage_team ?? user.can_manage_team}
                      onChange={(e) => handlePermissionChange(user.id, 'can_manage_team', e.target.checked)}
                      disabled={
                        !canManageTeam ||
                        busyUserId === user.id ||
                        currentUser?.role !== 'admin'
                      }
                    />
                    team
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={permissionDrafts[user.id]?.can_delete ?? user.can_delete}
                      onChange={(e) => handlePermissionChange(user.id, 'can_delete', e.target.checked)}
                      disabled={!canManageTeam || busyUserId === user.id}
                    />
                    delete
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={permissionDrafts[user.id]?.can_import ?? user.can_import}
                      onChange={(e) => handlePermissionChange(user.id, 'can_import', e.target.checked)}
                      disabled={!canManageTeam || busyUserId === user.id}
                    />
                    import
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={permissionDrafts[user.id]?.can_bulk_edit ?? user.can_bulk_edit}
                      onChange={(e) => handlePermissionChange(user.id, 'can_bulk_edit', e.target.checked)}
                      disabled={!canManageTeam || busyUserId === user.id}
                    />
                    bulk
                  </label>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSavePermissions(user)}
                  disabled={!canManageTeam || busyUserId === user.id || !isPermissionChanged(user)}
                >
                  Сохранить права
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleResetPassword(user)}
                  disabled={!canManageTeam || busyUserId === user.id}
                >
                  Сброс пароля
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleDeactivate(user)}
                  disabled={!canManageTeam || busyUserId === user.id || user.id === currentUser?.id}
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
        <p className="text-sm text-muted-foreground mb-4">
          Создает новую учетную запись. Передайте сотруднику email и временный пароль.
        </p>
        <form onSubmit={handleInvite} className="space-y-4 max-w-xl">
          <div className="space-y-1">
            <Label>ФИО</Label>
            <Input
              placeholder="Иван Петров"
              value={invite.name}
              onChange={(e) => setInvite((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              type="email"
              placeholder="ivan@example.com"
              value={invite.email}
              onChange={(e) => setInvite((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Роль</Label>
            <select
              value={invite.role}
              onChange={(e) => setInvite((f) => ({ ...f, role: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              <option value="developer">Developer</option>
              <option value="manager">Manager</option>
              {currentUser?.role === 'admin' && <option value="admin">Admin</option>}
            </select>
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
          <Button type="submit" disabled={inviting || !canManageTeam}>
            {inviting ? 'Создание...' : 'Создать аккаунт'}
          </Button>
          {!canManageTeam && (
            <p className="text-xs text-muted-foreground">Только администратор может управлять командой.</p>
          )}
          {inviteSuccess && <p className="text-sm text-green-600">{inviteSuccess}</p>}
          {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
        </form>
      </div>
    </div>
  )
}
