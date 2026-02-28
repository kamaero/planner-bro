import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Department, User, ReportDispatchSettings } from '@/types'

type UserDraft = Pick<
  User,
  'role' | 'work_email' | 'position_title' | 'manager_id' | 'department_id' | 'can_manage_team' | 'can_delete' | 'can_import' | 'can_bulk_edit'
>

export function Team() {
  const currentUser = useAuthStore((s) => s.user)
  const [section, setSection] = useState<'overview' | 'users' | 'org' | 'settings'>('overview')
  const [users, setUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({})
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, UserDraft>>({})
  const [departmentDrafts, setDepartmentDrafts] = useState<Record<string, { parent_id: string; head_user_id: string }>>({})

  const [invite, setInvite] = useState({
    first_name: '',
    last_name: '',
    email: '',
    work_email: '',
    role: 'developer',
    password: '',
    position_title: '',
    manager_id: '',
    department_id: '',
  })
  const [inviting, setInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [inviteError, setInviteError] = useState('')

  const [newDepartmentName, setNewDepartmentName] = useState('')
  const [newDepartmentParentId, setNewDepartmentParentId] = useState('')
  const [newDepartmentHeadId, setNewDepartmentHeadId] = useState('')
  const [creatingDepartment, setCreatingDepartment] = useState(false)
  const [changingOwnPassword, setChangingOwnPassword] = useState(false)
  const [ownPasswordSuccess, setOwnPasswordSuccess] = useState('')
  const [ownPasswordError, setOwnPasswordError] = useState('')
  const [ownPasswordForm, setOwnPasswordForm] = useState({ current_password: '', new_password: '' })
  const [reportSettings, setReportSettings] = useState<ReportDispatchSettings>({
    telegram_summaries_enabled: true,
    email_analytics_enabled: true,
    email_analytics_recipients: '',
    digest_filters: {
      deadline_window_days: 5,
      priorities: ['high', 'critical'],
      include_control_ski: true,
      include_escalations: true,
      include_without_deadline: false,
      anti_noise_enabled: true,
      anti_noise_ttl_minutes: 360,
    },
  })
  const [reportSettingsLoading, setReportSettingsLoading] = useState(false)
  const [reportSettingsSaving, setReportSettingsSaving] = useState(false)
  const [reportSettingsMessage, setReportSettingsMessage] = useState('')

  const [nameDrafts, setNameDrafts] = useState<Record<string, { first_name: string; last_name: string }>>({})
  const [nameBusyId, setNameBusyId] = useState<string | null>(null)

  const { setUser } = useAuthStore()

  const canManageTeam = currentUser?.role === 'admin' || currentUser?.can_manage_team
  const canCreateSubordinates = canManageTeam || currentUser?.role === 'manager'

  const usersById = useMemo(() => {
    const map: Record<string, User> = {}
    users.forEach((u) => { map[u.id] = u })
    return map
  }, [users])

  const subordinateTree = useMemo(() => {
    const grouped: Record<string, User[]> = {}
    users.forEach((u) => {
      const key = u.manager_id || 'root'
      grouped[key] = grouped[key] || []
      grouped[key].push(u)
    })
    Object.values(grouped).forEach((arr) => arr.sort((a, b) => a.name.localeCompare(b.name)))
    return grouped
  }, [users])

  const departmentsById = useMemo(() => {
    const map: Record<string, string> = {}
    departments.forEach((d) => { map[d.id] = d.name })
    return map
  }, [departments])

  const formatDateTime = (iso?: string | null) => {
    if (!iso) return '—'
    const dt = new Date(iso)
    if (Number.isNaN(dt.getTime())) return '—'
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dt)
  }

  const loadAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [userData, departmentData] = await Promise.all([api.listUsers(), api.listDepartments()])
      setUsers(userData)
      setDepartments(departmentData)
      const drafts: Record<string, UserDraft> = {}
      const nDrafts: Record<string, { first_name: string; last_name: string }> = {}
      userData.forEach((user: User) => {
        drafts[user.id] = {
          role: user.role,
          work_email: user.work_email ?? null,
          position_title: user.position_title ?? null,
          manager_id: user.manager_id ?? null,
          department_id: user.department_id ?? null,
          can_manage_team: user.can_manage_team,
          can_delete: user.can_delete,
          can_import: user.can_import,
          can_bulk_edit: user.can_bulk_edit,
        }
        nDrafts[user.id] = { first_name: user.first_name ?? '', last_name: user.last_name ?? '' }
      })
      setPermissionDrafts(drafts)
      const depDrafts: Record<string, { parent_id: string; head_user_id: string }> = {}
      departmentData.forEach((d: Department) => {
        depDrafts[d.id] = { parent_id: d.parent_id ?? '', head_user_id: d.head_user_id ?? '' }
      })
      setDepartmentDrafts(depDrafts)
      setNameDrafts(nDrafts)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось загрузить данные команды')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  const loadReportSettings = async () => {
    if (!canManageTeam) return
    setReportSettingsLoading(true)
    setReportSettingsMessage('')
    try {
      const data = await api.getReportDispatchSettings()
      setReportSettings(data)
    } catch (err: any) {
      setReportSettingsMessage(err?.response?.data?.detail ?? 'Не удалось загрузить настройки рассылки')
    } finally {
      setReportSettingsLoading(false)
    }
  }

  useEffect(() => {
    if (section !== 'settings' || !canManageTeam) return
    void loadReportSettings()
  }, [section, canManageTeam])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setInviteError('')
    setInviteSuccess('')
    try {
      const fullName = `${invite.first_name.trim()} ${invite.last_name.trim()}`.trim()
      await api.createUser({
        name: fullName,
        first_name: invite.first_name.trim(),
        last_name: invite.last_name.trim(),
        email: invite.email,
        work_email: invite.work_email || undefined,
        password: invite.password,
        role: invite.role,
        position_title: invite.position_title || undefined,
        manager_id: invite.manager_id || undefined,
        department_id: invite.department_id || undefined,
      })
      setInviteSuccess(`Аккаунт создан: ${invite.email}`)
      setInvite({
        first_name: '',
        last_name: '',
        email: '',
        work_email: '',
        role: 'developer',
        password: '',
        position_title: '',
        manager_id: '',
        department_id: '',
      })
      await loadAll()
    } catch (err: any) {
      setInviteError(err?.response?.data?.detail ?? 'Не удалось создать аккаунт')
    } finally {
      setInviting(false)
    }
  }

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canManageTeam || !newDepartmentName.trim()) return
    setCreatingDepartment(true)
    try {
      await api.createDepartment({
        name: newDepartmentName.trim(),
        parent_id: newDepartmentParentId || null,
        head_user_id: newDepartmentHeadId || null,
      })
      setNewDepartmentName('')
      setNewDepartmentParentId('')
      setNewDepartmentHeadId('')
      await loadAll()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось создать отдел')
    } finally {
      setCreatingDepartment(false)
    }
  }

  const handleDeleteDepartment = async (department: Department) => {
    if (!canManageTeam) return
    if (!window.confirm(`Удалить отдел ${department.name}?`)) return
    try {
      await api.deleteDepartment(department.id)
      await loadAll()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось удалить отдел')
    }
  }

  const handleDepartmentDraftChange = (
    departmentId: string,
    field: 'parent_id' | 'head_user_id',
    value: string
  ) => {
    setDepartmentDrafts((prev) => ({
      ...prev,
      [departmentId]: { ...(prev[departmentId] ?? { parent_id: '', head_user_id: '' }), [field]: value },
    }))
  }

  const handleSaveDepartment = async (department: Department) => {
    if (!canManageTeam) return
    const draft = departmentDrafts[department.id]
    if (!draft) return
    try {
      await api.updateDepartment(department.id, {
        parent_id: draft.parent_id || null,
        head_user_id: draft.head_user_id || null,
      })
      await loadAll()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось обновить отдел')
    }
  }

  const handleSaveName = async (user: User) => {
    const draft = nameDrafts[user.id]
    if (!draft) return
    setNameBusyId(user.id)
    setError('')
    try {
      let updated: User
      if (user.id === currentUser?.id) {
        updated = await api.updateMe({ first_name: draft.first_name.trim(), last_name: draft.last_name.trim() })
        setUser(updated)
      } else {
        if (!canManageTeam) return
        updated = await api.updateUserName(user.id, draft)
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)))
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось обновить имя')
    } finally {
      setNameBusyId(null)
    }
  }

  const isNameChanged = (user: User) => {
    const draft = nameDrafts[user.id]
    if (!draft) return false
    return draft.first_name !== (user.first_name ?? '') || draft.last_name !== (user.last_name ?? '')
  }

  const handleResetPassword = async (user: User) => {
    if (!canCreateSubordinates) return
    if (user.id === currentUser?.id) {
      setError('Сброс собственного пароля через список команды отключен')
      return
    }
    if (!window.confirm(`Сбросить пароль для ${user.name} (${user.email})?`)) return
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

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setChangingOwnPassword(true)
    setOwnPasswordError('')
    setOwnPasswordSuccess('')
    try {
      await api.changeMyPassword(ownPasswordForm)
      setOwnPasswordSuccess('Пароль успешно обновлен')
      setOwnPasswordForm({ current_password: '', new_password: '' })
    } catch (err: any) {
      setOwnPasswordError(err?.response?.data?.detail ?? 'Не удалось изменить пароль')
    } finally {
      setChangingOwnPassword(false)
    }
  }

  const handleDeactivate = async (user: User) => {
    if (!canCreateSubordinates) return
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

  const handlePermissionChange = (userId: string, field: keyof UserDraft, value: string | boolean) => {
    setPermissionDrafts((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] ?? {
          role: 'developer',
          work_email: null,
          position_title: null,
          manager_id: null,
          department_id: null,
          can_manage_team: false,
          can_delete: false,
          can_import: false,
          can_bulk_edit: false,
        }),
        [field]: value,
      },
    }))
  }

  const isPermissionChanged = (user: User) => {
    const draft = permissionDrafts[user.id]
    if (!draft) return false
    return (
      draft.role !== user.role ||
      (draft.work_email ?? '') !== (user.work_email ?? '') ||
      (draft.position_title ?? '') !== (user.position_title ?? '') ||
      (draft.manager_id ?? '') !== (user.manager_id ?? '') ||
      (draft.department_id ?? '') !== (user.department_id ?? '') ||
      draft.can_manage_team !== user.can_manage_team ||
      draft.can_delete !== user.can_delete ||
      draft.can_import !== user.can_import ||
      draft.can_bulk_edit !== user.can_bulk_edit
    )
  }

  const handleSavePermissions = async (user: User) => {
    const draft = permissionDrafts[user.id]
    if (!draft) return
    setBusyUserId(user.id)
    setError('')
    try {
      const updated = await api.updateUserPermissions(user.id, {
        ...draft,
        work_email: draft.work_email?.trim() ? draft.work_email.trim() : null,
        position_title: draft.position_title?.trim() ? draft.position_title.trim() : null,
        manager_id: draft.manager_id || null,
        department_id: draft.department_id || null,
      })
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)))
      setPermissionDrafts((prev) => ({
        ...prev,
        [user.id]: {
          role: updated.role,
          work_email: updated.work_email ?? null,
          position_title: updated.position_title ?? null,
          manager_id: updated.manager_id ?? null,
          department_id: updated.department_id ?? null,
          can_manage_team: updated.can_manage_team,
          can_delete: updated.can_delete,
          can_import: updated.can_import,
          can_bulk_edit: updated.can_bulk_edit,
        },
      }))
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось обновить карточку сотрудника')
    } finally {
      setBusyUserId(null)
    }
  }

  const handleSaveReportSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canManageTeam) return
    setReportSettingsSaving(true)
    setReportSettingsMessage('')
    try {
      const saved = await api.updateReportDispatchSettings({
        telegram_summaries_enabled: reportSettings.telegram_summaries_enabled,
        email_analytics_enabled: reportSettings.email_analytics_enabled,
        email_analytics_recipients: reportSettings.email_analytics_recipients,
        digest_filters: reportSettings.digest_filters,
      })
      setReportSettings(saved)
      setReportSettingsMessage('Настройки рассылки сохранены')
    } catch (err: any) {
      setReportSettingsMessage(err?.response?.data?.detail ?? 'Не удалось сохранить настройки рассылки')
    } finally {
      setReportSettingsSaving(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Команда</h1>
        <p className="text-sm text-muted-foreground">
          Разделен на подразделы: обзор, управление пользователями, оргструктура, настройки.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={section === 'overview' ? 'default' : 'outline'} onClick={() => setSection('overview')}>
          Список команды
        </Button>
        <Button variant={section === 'users' ? 'default' : 'outline'} onClick={() => setSection('users')}>
          Управление пользователями
        </Button>
        <Button variant={section === 'org' ? 'default' : 'outline'} onClick={() => setSection('org')}>
          Управление оргструктурой
        </Button>
        <Button variant={section === 'settings' ? 'default' : 'outline'} onClick={() => setSection('settings')}>
          Настройки
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {section === 'overview' && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Текущая команда</h2>
            <p className="text-xs text-muted-foreground">
              Пользователей: {users.length} · Отделов: {departments.length}
            </p>
          </div>
          {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
          {!loading && users.length === 0 && <p className="text-sm text-muted-foreground">Активных аккаунтов пока нет.</p>}
          {!loading && users.length > 0 && (
            <div className="overflow-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Имя Фамилия</th>
                    <th className="px-3 py-2 font-medium">Отдел</th>
                    <th className="px-3 py-2 font-medium">Last sign-in</th>
                  </tr>
                </thead>
                <tbody>
                  {users
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
                    .map((user) => (
                      <tr key={user.id} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium">{user.name}</div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {departmentsById[user.department_id || ''] || 'не назначен'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDateTime(user.last_sign_in_at ?? user.last_login_at)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {section === 'org' && (
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
                        Руководитель: {usersById[d.head_user_id || '']?.name || 'не назначен'}
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
                          <option key={u.id} value={u.id}>{u.name}</option>
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
                    <p className="font-medium">{rootUser.name} ({rootUser.role})</p>
                    {(subordinateTree[rootUser.id] || []).map((child) => (
                      <p key={child.id} className="ml-4 text-xs text-muted-foreground">
                        ↳ {child.name} ({child.position_title || child.role})
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
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={creatingDepartment}>
                {creatingDepartment ? 'Создание...' : 'Создать отдел'}
              </Button>
            </form>
          )}
        </div>
      )}

      {section === 'users' && (
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
                    <p className="text-sm font-medium truncate">{user.name} — {user.email}</p>
                    <p className="text-xs text-muted-foreground">Корпоративная почта: {user.work_email || 'не указана'}</p>
                    <p className="text-xs text-muted-foreground">Должность: {permissionDrafts[user.id]?.position_title || 'не указана'}</p>
                    <p className="text-xs text-muted-foreground">
                      Руководитель: {usersById[permissionDrafts[user.id]?.manager_id || '']?.name || 'не назначен'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Отдел: {departments.find((d) => d.id === (permissionDrafts[user.id]?.department_id || ''))?.name || 'не назначен'}
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
                          <option key={u.id} value={u.id}>{u.name}</option>
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
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={permissionDrafts[user.id]?.can_manage_team ?? user.can_manage_team}
                            onChange={(e) => handlePermissionChange(user.id, 'can_manage_team', e.target.checked)}
                            disabled={currentUser?.role !== 'admin'}
                          />
                          team
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={permissionDrafts[user.id]?.can_delete ?? user.can_delete}
                            onChange={(e) => handlePermissionChange(user.id, 'can_delete', e.target.checked)}
                          />
                          delete
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={permissionDrafts[user.id]?.can_import ?? user.can_import}
                            onChange={(e) => handlePermissionChange(user.id, 'can_import', e.target.checked)}
                          />
                          import
                        </label>
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={permissionDrafts[user.id]?.can_bulk_edit ?? user.can_bulk_edit}
                            onChange={(e) => handlePermissionChange(user.id, 'can_bulk_edit', e.target.checked)}
                          />
                          bulk
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
                      <option key={u.id} value={u.id}>{u.name}</option>
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
      )}

      {section === 'settings' && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-4 space-y-3 max-w-2xl">
            <h2 className="font-semibold">Сменить свой пароль</h2>
            <form onSubmit={handleChangeOwnPassword} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="current-password">Текущий пароль</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={ownPasswordForm.current_password}
                    onChange={(e) => setOwnPasswordForm((f) => ({ ...f, current_password: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-password">Новый пароль</Label>
                  <Input
                    id="new-password"
                    type="password"
                    minLength={6}
                    value={ownPasswordForm.new_password}
                    onChange={(e) => setOwnPasswordForm((f) => ({ ...f, new_password: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <Button type="submit" disabled={changingOwnPassword}>
                {changingOwnPassword ? 'Сохранение...' : 'Сменить пароль'}
              </Button>
              {ownPasswordSuccess && <p className="text-sm text-green-600">{ownPasswordSuccess}</p>}
              {ownPasswordError && <p className="text-sm text-destructive">{ownPasswordError}</p>}
            </form>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3 max-w-2xl">
            <h2 className="font-semibold">Настройки рассылки отчетов</h2>
            {!canManageTeam && (
              <p className="text-sm text-muted-foreground">
                Управление рассылкой доступно только менеджерам и администраторам.
              </p>
            )}
            {canManageTeam && (
              <form onSubmit={handleSaveReportSettings} className="space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reportSettings.telegram_summaries_enabled}
                    onChange={(e) =>
                      setReportSettings((prev) => ({ ...prev, telegram_summaries_enabled: e.target.checked }))
                    }
                    disabled={reportSettingsLoading || reportSettingsSaving}
                  />
                  Telegram-дайджесты включены
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={reportSettings.email_analytics_enabled}
                    onChange={(e) =>
                      setReportSettings((prev) => ({ ...prev, email_analytics_enabled: e.target.checked }))
                    }
                    disabled={reportSettingsLoading || reportSettingsSaving}
                  />
                  Email-дайджесты аналитики включены
                </label>

                <div className="space-y-1">
                  <Label htmlFor="email-analytics-recipients">Дополнительные получатели email</Label>
                  <Input
                    id="email-analytics-recipients"
                    value={reportSettings.email_analytics_recipients}
                    onChange={(e) =>
                      setReportSettings((prev) => ({ ...prev, email_analytics_recipients: e.target.value }))
                    }
                    placeholder="cto@company.ru, pm@company.ru"
                    disabled={reportSettingsLoading || reportSettingsSaving}
                  />
                  <p className="text-xs text-muted-foreground">
                    Через запятую. Менеджеры/админы команды добавляются автоматически.
                  </p>
                </div>

                <div className="rounded-lg border p-3 space-y-3">
                  <p className="text-sm font-medium">Умные фильтры дайджеста</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="digest-deadline-window">Окно по дедлайну (дней)</Label>
                      <Input
                        id="digest-deadline-window"
                        type="number"
                        min={0}
                        max={60}
                        value={reportSettings.digest_filters?.deadline_window_days ?? 5}
                        onChange={(e) =>
                          setReportSettings((prev) => ({
                            ...prev,
                            digest_filters: {
                              ...(prev.digest_filters ?? {}),
                              deadline_window_days: Number(e.target.value || 0),
                              priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                              include_control_ski: prev.digest_filters?.include_control_ski ?? true,
                              include_escalations: prev.digest_filters?.include_escalations ?? true,
                              include_without_deadline: prev.digest_filters?.include_without_deadline ?? false,
                              anti_noise_enabled: prev.digest_filters?.anti_noise_enabled ?? true,
                              anti_noise_ttl_minutes: prev.digest_filters?.anti_noise_ttl_minutes ?? 360,
                            },
                          }))
                        }
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="digest-anti-noise-ttl">Анти-шум (минут)</Label>
                      <Input
                        id="digest-anti-noise-ttl"
                        type="number"
                        min={15}
                        max={1440}
                        value={reportSettings.digest_filters?.anti_noise_ttl_minutes ?? 360}
                        onChange={(e) =>
                          setReportSettings((prev) => ({
                            ...prev,
                            digest_filters: {
                              ...(prev.digest_filters ?? {}),
                              anti_noise_ttl_minutes: Number(e.target.value || 360),
                              deadline_window_days: prev.digest_filters?.deadline_window_days ?? 5,
                              priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                              include_control_ski: prev.digest_filters?.include_control_ski ?? true,
                              include_escalations: prev.digest_filters?.include_escalations ?? true,
                              include_without_deadline: prev.digest_filters?.include_without_deadline ?? false,
                              anti_noise_enabled: prev.digest_filters?.anti_noise_enabled ?? true,
                            },
                          }))
                        }
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={reportSettings.digest_filters?.include_control_ski ?? true}
                        onChange={(e) =>
                          setReportSettings((prev) => ({
                            ...prev,
                            digest_filters: {
                              ...(prev.digest_filters ?? {}),
                              include_control_ski: e.target.checked,
                              deadline_window_days: prev.digest_filters?.deadline_window_days ?? 5,
                              priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                              include_escalations: prev.digest_filters?.include_escalations ?? true,
                              include_without_deadline: prev.digest_filters?.include_without_deadline ?? false,
                              anti_noise_enabled: prev.digest_filters?.anti_noise_enabled ?? true,
                              anti_noise_ttl_minutes: prev.digest_filters?.anti_noise_ttl_minutes ?? 360,
                            },
                          }))
                        }
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                      Включать СКИ
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={reportSettings.digest_filters?.include_escalations ?? true}
                        onChange={(e) =>
                          setReportSettings((prev) => ({
                            ...prev,
                            digest_filters: {
                              ...(prev.digest_filters ?? {}),
                              include_escalations: e.target.checked,
                              deadline_window_days: prev.digest_filters?.deadline_window_days ?? 5,
                              priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                              include_control_ski: prev.digest_filters?.include_control_ski ?? true,
                              include_without_deadline: prev.digest_filters?.include_without_deadline ?? false,
                              anti_noise_enabled: prev.digest_filters?.anti_noise_enabled ?? true,
                              anti_noise_ttl_minutes: prev.digest_filters?.anti_noise_ttl_minutes ?? 360,
                            },
                          }))
                        }
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                      Включать эскалации
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={reportSettings.digest_filters?.include_without_deadline ?? false}
                        onChange={(e) =>
                          setReportSettings((prev) => ({
                            ...prev,
                            digest_filters: {
                              ...(prev.digest_filters ?? {}),
                              include_without_deadline: e.target.checked,
                              deadline_window_days: prev.digest_filters?.deadline_window_days ?? 5,
                              priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                              include_control_ski: prev.digest_filters?.include_control_ski ?? true,
                              include_escalations: prev.digest_filters?.include_escalations ?? true,
                              anti_noise_enabled: prev.digest_filters?.anti_noise_enabled ?? true,
                              anti_noise_ttl_minutes: prev.digest_filters?.anti_noise_ttl_minutes ?? 360,
                            },
                          }))
                        }
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                      Включать задачи без дедлайна
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={reportSettings.digest_filters?.anti_noise_enabled ?? true}
                        onChange={(e) =>
                          setReportSettings((prev) => ({
                            ...prev,
                            digest_filters: {
                              ...(prev.digest_filters ?? {}),
                              anti_noise_enabled: e.target.checked,
                              deadline_window_days: prev.digest_filters?.deadline_window_days ?? 5,
                              priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                              include_control_ski: prev.digest_filters?.include_control_ski ?? true,
                              include_escalations: prev.digest_filters?.include_escalations ?? true,
                              include_without_deadline: prev.digest_filters?.include_without_deadline ?? false,
                              anti_noise_ttl_minutes: prev.digest_filters?.anti_noise_ttl_minutes ?? 360,
                            },
                          }))
                        }
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                      Включить анти-шум
                    </label>
                  </div>
                </div>

                <Button type="submit" disabled={reportSettingsLoading || reportSettingsSaving}>
                  {reportSettingsSaving ? 'Сохранение...' : reportSettingsLoading ? 'Загрузка...' : 'Сохранить настройки рассылки'}
                </Button>
                {reportSettingsMessage && (
                  <p className="text-sm text-muted-foreground">{reportSettingsMessage}</p>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
