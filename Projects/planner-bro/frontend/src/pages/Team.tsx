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

  const [invite, setInvite] = useState({ name: '', email: '', role: 'developer', password: '' })
  const [inviting, setInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [inviteError, setInviteError] = useState('')

  const canManageTeam = currentUser?.role === 'admin'

  const loadUsers = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.listUsers()
      setUsers(data)
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
      await api.register({
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
                <p className="text-xs text-muted-foreground">Роль: {user.role}</p>
                {tempPasswords[user.id] && (
                  <p className="text-xs text-orange-600 mt-1">
                    Временный пароль: {tempPasswords[user.id]}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
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
              <option value="admin">Admin</option>
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
