import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import type { AuthLoginEvent, Department, User, TempAssignee, ReportDispatchSettings } from '@/types'
import { formatUserDisplayName } from '@/lib/userName'
import { Link } from 'react-router-dom'
import { TeamOverviewSection } from '@/components/Team/TeamOverviewSection'
import { TeamOrgSection } from '@/components/Team/TeamOrgSection'
import { TeamUsersManagementSection } from '@/components/Team/TeamUsersManagementSection'
import { TeamUserInviteSection } from '@/components/Team/TeamUserInviteSection'
import { TeamSettingsAccountSection } from '@/components/Team/TeamSettingsAccountSection'
import { TeamTempAssigneesSection } from '@/components/Team/TeamTempAssigneesSection'
import { TeamReportSettingsSection } from '@/components/Team/TeamReportSettingsSection'
import { useTeamReportSettings } from '@/hooks/useTeamReportSettings'
import { useTeamUsersAdminState } from '@/hooks/useTeamUsersAdminState'

export function Team() {
  const currentUser = useAuthStore((s) => s.user)
  const [section, setSection] = useState<'overview' | 'users' | 'org' | 'settings'>('overview')
  const [users, setUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loginEvents, setLoginEvents] = useState<AuthLoginEvent[]>([])
  const [loginEventsLoading, setLoginEventsLoading] = useState(false)
  const [loginEventsError, setLoginEventsError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({})
  const [departmentDrafts, setDepartmentDrafts] = useState<Record<string, { parent_id: string; head_user_id: string }>>({})
  const {
    permissionDrafts,
    setPermissionDrafts,
    nameDrafts,
    initializeUserDrafts,
    invite,
    resetInvite,
    inviting,
    setInviting,
    inviteSuccess,
    setInviteSuccess,
    inviteError,
    setInviteError,
    handleInviteFieldChange,
    handleInviteRoleChange,
    handlePermissionChange,
    isPermissionChanged,
    handleNameDraftChange,
    isNameChanged,
  } = useTeamUsersAdminState()

  const [newDepartmentName, setNewDepartmentName] = useState('')
  const [newDepartmentParentId, setNewDepartmentParentId] = useState('')
  const [newDepartmentHeadId, setNewDepartmentHeadId] = useState('')
  const [creatingDepartment, setCreatingDepartment] = useState(false)
  const [changingOwnPassword, setChangingOwnPassword] = useState(false)
  const [ownPasswordSuccess, setOwnPasswordSuccess] = useState('')
  const [ownPasswordError, setOwnPasswordError] = useState('')
  const [ownPasswordForm, setOwnPasswordForm] = useState({ current_password: '', new_password: '' })
  const {
    reportSettings,
    setReportSettings,
    weekdayOptions,
    timeWindowOptions,
    fixedDigestTimezone,
    getDigestPreset,
    updateDigestSchedule,
    updateDigestChannelDays,
    updateDigestChannelWindow,
    updateAdminDirective,
  } = useTeamReportSettings()
  const [reportSettingsLoading, setReportSettingsLoading] = useState(false)
  const [reportSettingsSaving, setReportSettingsSaving] = useState(false)
  const [reportSettingsMessage, setReportSettingsMessage] = useState('')
  const [adminDirectiveTestBusy, setAdminDirectiveTestBusy] = useState(false)
  const [tempAssignees, setTempAssignees] = useState<TempAssignee[]>([])
  const [tempAssigneesLoading, setTempAssigneesLoading] = useState(false)
  const [tempAssigneesError, setTempAssigneesError] = useState('')
  const [tempAssigneeBusyId, setTempAssigneeBusyId] = useState<string | null>(null)
  const [tempAssigneeLinkDrafts, setTempAssigneeLinkDrafts] = useState<Record<string, string>>({})

  const [nameBusyId, setNameBusyId] = useState<string | null>(null)

  const { setUser } = useAuthStore()

  const canManageTeam = Boolean(currentUser?.role === 'admin' || currentUser?.can_manage_team)
  const canCreateSubordinates = Boolean(canManageTeam || currentUser?.role === 'manager')

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
    Object.values(grouped).forEach((arr) =>
      arr.sort((a, b) => formatUserDisplayName(a).localeCompare(formatUserDisplayName(b)))
    )
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

  const getSignInStatus = (user: User) => {
    const raw = user.last_sign_in_at ?? user.last_login_at
    if (!raw) {
      return {
        label: 'никогда не входил',
        tone: 'border-red-200 bg-red-50 text-red-700',
      }
    }

    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) {
      return {
        label: 'статус не определён',
        tone: 'border-slate-200 bg-slate-50 text-slate-600',
      }
    }

    const diffHours = (Date.now() - dt.getTime()) / (1000 * 60 * 60)
    if (diffHours <= 72) {
      return {
        label: 'недавно активен',
        tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      }
    }
    if (diffHours <= 24 * 14) {
      return {
        label: 'заходил недавно',
        tone: 'border-amber-200 bg-amber-50 text-amber-700',
      }
    }
    return {
      label: 'давно не входил',
      tone: 'border-orange-200 bg-orange-50 text-orange-700',
    }
  }

  const getLoginEmailType = (event: AuthLoginEvent) => {
    if (!event.user_id) return 'неизвестно'
    const user = usersById[event.user_id]
    if (!user) return 'неизвестно'
    const work = (user.work_email || '').trim().toLowerCase()
    const normalized = (event.normalized_email || '').trim().toLowerCase()
    if (!work) return 'личный/н/д'
    return normalized === work ? 'корпоративный' : 'личный'
  }

  const getVisibilitySummary = (value?: User['visibility_scope']) => {
    if (value === 'own_tasks_only') return 'Видит в основном свои задачи и связанные проекты.'
    if (value === 'full_scope') return 'Видит всю систему без отделочных ограничений.'
    return 'Видит свой управленческий или departmental-контур.'
  }

  const getRoleSummary = (value?: User['role']) => {
    if (value === 'admin') return 'Полный доступ, глобальные настройки и сквозные назначения.'
    if (value === 'manager') return 'Управление людьми, проектами и задачами в рабочем контуре.'
    return 'Исполнение задач и работа в личном или ограниченном контуре.'
  }

  const loadAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [userData, departmentData] = await Promise.all([api.listUsers(), api.listDepartments()])
      setUsers(userData)
      setDepartments(departmentData)
      initializeUserDrafts(userData)
      const depDrafts: Record<string, { parent_id: string; head_user_id: string }> = {}
      departmentData.forEach((d: Department) => {
        depDrafts[d.id] = { parent_id: d.parent_id ?? '', head_user_id: d.head_user_id ?? '' }
      })
      setDepartmentDrafts(depDrafts)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось загрузить данные команды')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  const loadLoginEvents = async () => {
    if (!canManageTeam) return
    setLoginEventsLoading(true)
    setLoginEventsError('')
    try {
      const events = await api.listLoginEvents({ limit: 200 })
      setLoginEvents(events)
    } catch (err: any) {
      setLoginEventsError(err?.response?.data?.detail ?? 'Не удалось загрузить журнал входов')
    } finally {
      setLoginEventsLoading(false)
    }
  }

  useEffect(() => {
    if (section !== 'overview' || !canManageTeam) return
    void loadLoginEvents()
  }, [section, canManageTeam])

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

  const loadTempAssignees = async () => {
    if (!canManageTeam) return
    setTempAssigneesLoading(true)
    setTempAssigneesError('')
    try {
      const data = await api.listTempAssignees({ status: 'pending', limit: 500 })
      setTempAssignees(data)
      const drafts: Record<string, string> = {}
      data.forEach((item: TempAssignee) => {
        drafts[item.id] = item.linked_user_id ?? ''
      })
      setTempAssigneeLinkDrafts(drafts)
    } catch (err: any) {
      setTempAssigneesError(err?.response?.data?.detail ?? 'Не удалось загрузить temp-исполнителей')
    } finally {
      setTempAssigneesLoading(false)
    }
  }

  useEffect(() => {
    if (section !== 'settings' || !canManageTeam) return
    void loadReportSettings()
    void loadTempAssignees()
  }, [section, canManageTeam])

  const handleLinkTempAssignee = async (item: TempAssignee) => {
    const userId = (tempAssigneeLinkDrafts[item.id] || '').trim()
    if (!userId) return
    setTempAssigneeBusyId(item.id)
    try {
      await api.linkTempAssignee(item.id, userId)
      await loadTempAssignees()
    } catch (err: any) {
      setTempAssigneesError(err?.response?.data?.detail ?? 'Не удалось связать temp-исполнителя')
    } finally {
      setTempAssigneeBusyId(null)
    }
  }

  const handleIgnoreTempAssignee = async (item: TempAssignee) => {
    setTempAssigneeBusyId(item.id)
    try {
      await api.ignoreTempAssignee(item.id)
      await loadTempAssignees()
    } catch (err: any) {
      setTempAssigneesError(err?.response?.data?.detail ?? 'Не удалось скрыть temp-исполнителя')
    } finally {
      setTempAssigneeBusyId(null)
    }
  }

  const handlePromoteTempAssignee = async (item: TempAssignee) => {
    const suggested = item.email || ''
    const email = window.prompt(`Email для создания аккаунта (${item.raw_name})`, suggested)?.trim()
    if (!email) return
    setTempAssigneeBusyId(item.id)
    try {
      const result = await api.promoteTempAssignee(item.id, { email, role: 'developer' })
      const temporaryPassword = result?.temporary_password as string | null | undefined
      if (temporaryPassword) {
        window.alert(`Аккаунт создан. Временный пароль: ${temporaryPassword}`)
      } else {
        window.alert('Аккаунт создан и связан с temp-исполнителем.')
      }
      await loadAll()
      await loadTempAssignees()
    } catch (err: any) {
      setTempAssigneesError(err?.response?.data?.detail ?? 'Не удалось создать пользователя из temp')
    } finally {
      setTempAssigneeBusyId(null)
    }
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setInviteError('')
    setInviteSuccess('')
    try {
      const fullName = `${invite.last_name.trim()} ${invite.first_name.trim()} ${invite.middle_name.trim()}`.trim()
      await api.createUser({
        name: fullName,
        first_name: invite.first_name.trim(),
        middle_name: invite.middle_name.trim(),
        last_name: invite.last_name.trim(),
        email: invite.email,
        work_email: invite.work_email || undefined,
        password: invite.password,
        role: invite.role,
        visibility_scope: invite.visibility_scope,
        own_tasks_visibility_enabled: invite.own_tasks_visibility_enabled,
        position_title: invite.position_title || undefined,
        manager_id: invite.manager_id || undefined,
        department_id: invite.department_id || undefined,
      })
      setInviteSuccess(`Аккаунт создан: ${invite.email}`)
      resetInvite()
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
        updated = await api.updateMe({
          first_name: draft.first_name.trim(),
          middle_name: draft.middle_name.trim(),
          last_name: draft.last_name.trim(),
        })
        setUser(updated)
      } else {
        if (!canManageTeam) return
        updated = await api.updateUserName(user.id, {
          first_name: draft.first_name.trim(),
          middle_name: draft.middle_name.trim(),
          last_name: draft.last_name.trim(),
        })
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)))
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось обновить имя')
    } finally {
      setNameBusyId(null)
    }
  }

  const handleResetPassword = async (user: User) => {
    if (!canCreateSubordinates) return
    if (user.id === currentUser?.id) {
      setError('Сброс собственного пароля через список команды отключен')
      return
    }
    if (!window.confirm(`Сбросить пароль для ${formatUserDisplayName(user)} (${user.email})?`)) return
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

  const handleOwnPasswordFormChange = (
    field: 'current_password' | 'new_password',
    value: string
  ) => {
    setOwnPasswordForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleDeactivate = async (user: User) => {
    if (!canCreateSubordinates) return
    if (!window.confirm(`Отключить сотрудника ${formatUserDisplayName(user)}?`)) return
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

  const handleSavePermissions = async (user: User) => {
    const draft = permissionDrafts[user.id]
    if (!draft) return
    setBusyUserId(user.id)
    setError('')
    try {
      const canChangeOwnOnlyToggle =
        currentUser?.role === 'admin' || user.manager_id === currentUser?.id
      const updated = await api.updateUserPermissions(user.id, {
        ...draft,
        visibility_scope: draft.visibility_scope ?? 'department_scope',
        own_tasks_visibility_enabled: canChangeOwnOnlyToggle
          ? (draft.own_tasks_visibility_enabled ?? true)
          : undefined,
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
          visibility_scope: updated.visibility_scope ?? 'department_scope',
          own_tasks_visibility_enabled: updated.own_tasks_visibility_enabled ?? true,
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
      const digestSchedule = reportSettings.digest_schedule
        ? {
            ...reportSettings.digest_schedule,
            timezone: fixedDigestTimezone,
          }
        : undefined
      const saved = await api.updateReportDispatchSettings({
        smtp_enabled: reportSettings.smtp_enabled,
        telegram_summaries_enabled: reportSettings.telegram_summaries_enabled,
        email_analytics_enabled: reportSettings.email_analytics_enabled,
        email_analytics_recipients: reportSettings.email_analytics_recipients,
        admin_directive: reportSettings.admin_directive,
        digest_filters: reportSettings.digest_filters,
        digest_schedule: digestSchedule,
      })
      setReportSettings(saved)
      setReportSettingsMessage('Настройки рассылки сохранены')
    } catch (err: any) {
      setReportSettingsMessage(err?.response?.data?.detail ?? 'Не удалось сохранить настройки рассылки')
    } finally {
      setReportSettingsSaving(false)
    }
  }

  const handleTempAssigneeLinkDraftChange = (tempAssigneeId: string, userId: string) => {
    setTempAssigneeLinkDrafts((prev) => ({ ...prev, [tempAssigneeId]: userId }))
  }

  const handleAdminDirectiveTest = async () => {
    if (!canManageTeam) return
    setAdminDirectiveTestBusy(true)
    setReportSettingsMessage('')
    try {
      const recipient = reportSettings.admin_directive?.recipient?.trim() || 'aerokamero@gmail.com'
      const result = await api.runAdminDirectiveTest({ recipient })
      setReportSettingsMessage(
        `Тест отправлен: ${result.recipient}. Просрочки: ${result.overdue_count}, без движения: ${result.stale_count}, без назначений: ${result.unassigned_count}.`
      )
    } catch (err: any) {
      setReportSettingsMessage(err?.response?.data?.detail ?? 'Не удалось отправить тестовую рассылку')
    } finally {
      setAdminDirectiveTestBusy(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Команда</h1>
        <p className="text-sm text-muted-foreground">
          Разделен на подразделы: обзор, управление пользователями, оргструктура, настройки.
        </p>
        <Link
          to="/help#roles"
          className="mt-2 inline-flex text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          Как работают роли, видимость и last sign-in
        </Link>
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
        <TeamOverviewSection
          users={users}
          departmentsCount={departments.length}
          departmentsById={departmentsById}
          loading={loading}
          canManageTeam={canManageTeam}
          loginEvents={loginEvents}
          loginEventsLoading={loginEventsLoading}
          loginEventsError={loginEventsError}
          formatDateTime={formatDateTime}
          getSignInStatus={getSignInStatus}
          getLoginEmailType={getLoginEmailType}
          onReloadLoginEvents={() => void loadLoginEvents()}
        />
      )}

      {section === 'org' && (
        <TeamOrgSection
          departments={departments}
          users={users}
          usersById={usersById}
          subordinateTree={subordinateTree}
          departmentDrafts={departmentDrafts}
          canManageTeam={canManageTeam}
          creatingDepartment={creatingDepartment}
          newDepartmentName={newDepartmentName}
          newDepartmentParentId={newDepartmentParentId}
          newDepartmentHeadId={newDepartmentHeadId}
          onDepartmentDraftChange={handleDepartmentDraftChange}
          onSaveDepartment={handleSaveDepartment}
          onDeleteDepartment={handleDeleteDepartment}
          onCreateDepartment={handleCreateDepartment}
          onNewDepartmentNameChange={setNewDepartmentName}
          onNewDepartmentParentIdChange={setNewDepartmentParentId}
          onNewDepartmentHeadIdChange={setNewDepartmentHeadId}
        />
      )}

      {section === 'users' && (
        <>
          <TeamUsersManagementSection
            loading={loading}
            users={users}
            departments={departments}
            usersById={usersById}
            permissionDrafts={permissionDrafts}
            tempPasswords={tempPasswords}
            nameDrafts={nameDrafts}
            currentUserId={currentUser?.id}
            currentUserRole={currentUser?.role}
            canManageTeam={canManageTeam}
            canCreateSubordinates={canCreateSubordinates}
            busyUserId={busyUserId}
            nameBusyId={nameBusyId}
            getRoleSummary={getRoleSummary}
            getVisibilitySummary={getVisibilitySummary}
            isNameChanged={isNameChanged}
            isPermissionChanged={isPermissionChanged}
            onNameDraftChange={handleNameDraftChange}
            onSaveName={handleSaveName}
            onPermissionChange={handlePermissionChange}
            onSavePermissions={handleSavePermissions}
            onResetPassword={handleResetPassword}
            onDeactivate={handleDeactivate}
          />

          <TeamUserInviteSection
            users={users}
            departments={departments}
            invite={invite}
            inviting={inviting}
            inviteSuccess={inviteSuccess}
            inviteError={inviteError}
            canCreateSubordinates={canCreateSubordinates}
            currentUserRole={currentUser?.role}
            onInviteSubmit={handleInvite}
            onInviteFieldChange={handleInviteFieldChange}
            onInviteRoleChange={handleInviteRoleChange}
          />
        </>
      )}

      {section === 'settings' && (
        <div className="space-y-4">
          <TeamSettingsAccountSection
            ownPasswordForm={ownPasswordForm}
            changingOwnPassword={changingOwnPassword}
            ownPasswordSuccess={ownPasswordSuccess}
            ownPasswordError={ownPasswordError}
            ownTasksVisibilityEnabled={currentUser?.own_tasks_visibility_enabled ?? true}
            onChangeOwnPassword={handleChangeOwnPassword}
            onOwnPasswordFieldChange={handleOwnPasswordFormChange}
          />

          <TeamTempAssigneesSection
            users={users}
            tempAssignees={tempAssignees}
            tempAssigneesLoading={tempAssigneesLoading}
            tempAssigneesError={tempAssigneesError}
            tempAssigneeBusyId={tempAssigneeBusyId}
            tempAssigneeLinkDrafts={tempAssigneeLinkDrafts}
            onReload={() => void loadTempAssignees()}
            onLinkDraftChange={handleTempAssigneeLinkDraftChange}
            onLink={(item) => void handleLinkTempAssignee(item)}
            onPromote={(item) => void handlePromoteTempAssignee(item)}
            onIgnore={(item) => void handleIgnoreTempAssignee(item)}
          />
          <TeamReportSettingsSection
            canManageTeam={canManageTeam}
            reportSettings={reportSettings}
            reportSettingsLoading={reportSettingsLoading}
            reportSettingsSaving={reportSettingsSaving}
            reportSettingsMessage={reportSettingsMessage}
            adminDirectiveTestBusy={adminDirectiveTestBusy}
            weekdayOptions={weekdayOptions}
            timeWindowOptions={timeWindowOptions}
            fixedDigestTimezone={fixedDigestTimezone}
            setReportSettings={setReportSettings}
            onSaveReportSettings={handleSaveReportSettings}
            onAdminDirectiveTest={handleAdminDirectiveTest}
            updateAdminDirective={updateAdminDirective}
            updateDigestSchedule={updateDigestSchedule}
            getDigestPreset={getDigestPreset}
            updateDigestChannelDays={updateDigestChannelDays}
            updateDigestChannelWindow={updateDigestChannelWindow}
          />
        </div>
      )}
    </div>
  )
}
