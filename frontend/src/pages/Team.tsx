import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useExternalContractors, useCreateExternalContractor, useDeleteExternalContractor } from '@/hooks/useProjects'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { AuthLoginEvent, Department, TempAssignee, User } from '@/types'
import { formatUserDisplayName } from '@/lib/userName'
import { useTeamOwnPassword } from '@/hooks/useTeamOwnPassword'
import { useTeamLoginEvents } from '@/hooks/useTeamLoginEvents'
import { useTeamTempAssignees } from '@/hooks/useTeamTempAssignees'
import { useTeamDepartmentCreate } from '@/hooks/useTeamDepartmentCreate'
import { useTeamUsersAdminState } from '@/hooks/useTeamUsersAdminState'
import { useTeamReportSettings } from '@/hooks/useTeamReportSettings'
import { useTeamCoreData } from '@/hooks/useTeamCoreData'
import { TeamOverviewSection } from '@/components/Team/TeamOverviewSection'
import { TeamOrgSection } from '@/components/Team/TeamOrgSection'
import { TeamUsersSection } from '@/components/Team/TeamUsersSection'
import { TeamSettingsSection } from '@/components/Team/TeamSettingsSection'

export function Team() {
  const currentUser = useAuthStore((s) => s.user)
  const canManageTeam = currentUser?.role === 'admin' || currentUser?.can_manage_team
  const canCreateSubordinates = canManageTeam || currentUser?.role === 'manager'

  const [section, setSection] = useState<'org' | 'mailing' | 'profile'>('org')
  const { users, setUsers, departments, loading, error, setError, loadAll: loadCoreData } = useTeamCoreData()
  const { loginEvents, loginEventsLoading, loginEventsError, loadLoginEvents } = useTeamLoginEvents(!!canManageTeam)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({})
  const [departmentDrafts, setDepartmentDrafts] = useState<Record<string, { parent_id: string; head_user_id: string }>>({})
  const {
    permissionDrafts,
    setPermissionDrafts,
    nameDrafts,
    setNameDrafts,
    initializeUserDrafts,
    invite,
    setInvite,
    resetInvite,
    inviting,
    setInviting,
    inviteSuccess,
    setInviteSuccess,
    inviteError,
    setInviteError,
    handlePermissionChange,
    isPermissionChanged,
    isNameChanged,
  } = useTeamUsersAdminState()

  const {
    changingOwnPassword,
    ownPasswordSuccess,
    ownPasswordError,
    ownPasswordForm,
    setOwnPasswordForm,
    handleChangeOwnPassword,
  } = useTeamOwnPassword()
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
  const loadAllRef = useRef<() => Promise<unknown>>(() => Promise.resolve())
  const {
    tempAssignees,
    tempAssigneesLoading,
    tempAssigneesError,
    tempAssigneeBusyId,
    tempAssigneeLinkDrafts,
    setTempAssigneeLinkDrafts,
    loadTempAssignees,
    handleLinkTempAssignee,
    handleIgnoreTempAssignee,
    handlePromoteTempAssignee,
  } = useTeamTempAssignees(!!canManageTeam, () => loadAllRef.current())
  const {
    newDepartmentName,
    setNewDepartmentName,
    newDepartmentParentId,
    setNewDepartmentParentId,
    newDepartmentHeadId,
    setNewDepartmentHeadId,
    creatingDepartment,
    handleCreateDepartment,
  } = useTeamDepartmentCreate(!!canManageTeam, () => loadAllRef.current())

  const [nameBusyId, setNameBusyId] = useState<string | null>(null)

  const { setUser } = useAuthStore()

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

  const getLoginEmailType = (event: AuthLoginEvent) => {
    if (!event.user_id) return 'неизвестно'
    const user = usersById[event.user_id]
    if (!user) return 'неизвестно'
    const work = (user.work_email || '').trim().toLowerCase()
    const normalized = (event.normalized_email || '').trim().toLowerCase()
    if (!work) return 'личный/н/д'
    return normalized === work ? 'корпоративный' : 'личный'
  }

  const loadAll = async () => {
    const result = await loadCoreData()
    if (!result) return
    initializeUserDrafts(result.users)
    const depDrafts: Record<string, { parent_id: string; head_user_id: string }> = {}
    result.departments.forEach((d: Department) => {
      depDrafts[d.id] = { parent_id: d.parent_id ?? '', head_user_id: d.head_user_id ?? '' }
    })
    setDepartmentDrafts(depDrafts)
  }

  loadAllRef.current = loadAll

  useEffect(() => {
    void loadAll()
  }, [])

  useEffect(() => {
    if (section !== 'org' || !canManageTeam) return
    void loadLoginEvents()
    void loadTempAssignees()
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

  useEffect(() => {
    if (section !== 'mailing' || !canManageTeam) return
    void loadReportSettings()
  }, [section, canManageTeam])

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
    const isSelf = user.id === currentUser?.id
    const isSuperadmin = currentUser?.email === 'aerokamero@gmail.com'
    if (!isSelf && !isSuperadmin) return
    const confirmMsg = isSelf
      ? `Сбросить ваш пароль? Новый временный пароль будет отправлен на ${user.work_email || user.email}.`
      : `Сбросить пароль для ${formatUserDisplayName(user)} (${user.work_email || user.email})?`
    if (!window.confirm(confirmMsg)) return
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
        email_test_mode: reportSettings.email_test_mode,
        email_test_recipient: reportSettings.email_test_recipient,
        telegram_summaries_enabled: false,
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
        <h1 className="text-2xl font-bold">Настройки</h1>
        <p className="text-sm text-muted-foreground">
          Оргструктура, рассылки и профиль.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={section === 'org' ? 'default' : 'outline'} onClick={() => setSection('org')}>
          Оргструктура
        </Button>
        <Button variant={section === 'mailing' ? 'default' : 'outline'} onClick={() => setSection('mailing')}>
          Рассылки
        </Button>
        <Button variant={section === 'profile' ? 'default' : 'outline'} onClick={() => setSection('profile')}>
          Мой профиль
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {section === 'org' && (
        <div className="space-y-6">
          <TeamOverviewSection
            users={users}
            departments={departments}
            loading={loading}
            canManageTeam={canManageTeam}
            departmentsById={departmentsById}
            loginEvents={loginEvents}
            loginEventsLoading={loginEventsLoading}
            loginEventsError={loginEventsError}
            loadLoginEvents={loadLoginEvents}
            formatDateTime={formatDateTime}
            getLoginEmailType={getLoginEmailType}
          />
          <TeamUsersSection
            users={users}
            departments={departments}
            loading={loading}
            canManageTeam={canManageTeam}
            canCreateSubordinates={canCreateSubordinates}
            currentUser={currentUser}
            permissionDrafts={permissionDrafts}
            nameDrafts={nameDrafts}
            setNameDrafts={setNameDrafts}
            tempPasswords={tempPasswords}
            busyUserId={busyUserId}
            nameBusyId={nameBusyId}
            handleSaveName={handleSaveName}
            handleSavePermissions={handleSavePermissions}
            handleResetPassword={handleResetPassword}
            handleDeactivate={handleDeactivate}
            isNameChanged={isNameChanged}
            isPermissionChanged={isPermissionChanged}
            handlePermissionChange={handlePermissionChange}
            usersById={usersById}
            invite={invite}
            setInvite={setInvite}
            inviting={inviting}
            inviteSuccess={inviteSuccess}
            inviteError={inviteError}
            handleInvite={handleInvite}
          />
          <TeamOrgSection
            departments={departments}
            users={users}
            canManageTeam={canManageTeam}
            departmentDrafts={departmentDrafts}
            handleDepartmentDraftChange={handleDepartmentDraftChange}
            handleSaveDepartment={handleSaveDepartment}
            handleDeleteDepartment={handleDeleteDepartment}
            subordinateTree={subordinateTree}
            usersById={usersById}
            newDepartmentName={newDepartmentName}
            setNewDepartmentName={setNewDepartmentName}
            newDepartmentParentId={newDepartmentParentId}
            setNewDepartmentParentId={setNewDepartmentParentId}
            newDepartmentHeadId={newDepartmentHeadId}
            setNewDepartmentHeadId={setNewDepartmentHeadId}
            creatingDepartment={creatingDepartment}
            handleCreateDepartment={handleCreateDepartment}
          />
          <ExternalContractorsSection />
          {canManageTeam && (
            <TempAssigneesSection
              tempAssignees={tempAssignees}
              tempAssigneesLoading={tempAssigneesLoading}
              tempAssigneesError={tempAssigneesError}
              tempAssigneeBusyId={tempAssigneeBusyId}
              tempAssigneeLinkDrafts={tempAssigneeLinkDrafts}
              setTempAssigneeLinkDrafts={setTempAssigneeLinkDrafts}
              loadTempAssignees={() => void loadTempAssignees()}
              handleLinkTempAssignee={(item) => void handleLinkTempAssignee(item)}
              handleIgnoreTempAssignee={(item) => void handleIgnoreTempAssignee(item)}
              handlePromoteTempAssignee={(item) => void handlePromoteTempAssignee(item)}
              users={users}
            />
          )}
        </div>
      )}

      {section === 'mailing' && (
        <TeamSettingsSection
          canManageTeam={canManageTeam}
          reportSettings={reportSettings}
          setReportSettings={setReportSettings}
          weekdayOptions={weekdayOptions}
          timeWindowOptions={timeWindowOptions}
          fixedDigestTimezone={fixedDigestTimezone}
          getDigestPreset={getDigestPreset}
          updateDigestSchedule={updateDigestSchedule}
          updateDigestChannelDays={updateDigestChannelDays}
          updateDigestChannelWindow={updateDigestChannelWindow}
          updateAdminDirective={updateAdminDirective}
          reportSettingsLoading={reportSettingsLoading}
          reportSettingsSaving={reportSettingsSaving}
          reportSettingsMessage={reportSettingsMessage}
          adminDirectiveTestBusy={adminDirectiveTestBusy}
          handleSaveReportSettings={handleSaveReportSettings}
          handleAdminDirectiveTest={handleAdminDirectiveTest}
        />
      )}

      {section === 'profile' && (
        <div className="space-y-4 max-w-2xl">
          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h2 className="font-semibold">Сменить пароль</h2>
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

          <div className="rounded-xl border bg-card p-4 space-y-2">
            <h2 className="font-semibold">Персональная email-рассылка</h2>
            <p className="text-sm text-muted-foreground">
              Настройка персональных уведомлений по email — в разработке.
            </p>
            <div className="flex items-center justify-between rounded border px-3 py-2 text-sm opacity-50">
              <span>Уведомления о назначении задач</span>
              <Switch checked disabled />
            </div>
            <div className="flex items-center justify-between rounded border px-3 py-2 text-sm opacity-50">
              <span>Напоминания о дедлайнах</span>
              <Switch checked disabled />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ExternalContractorsSection() {
  const { data: contractors = [] } = useExternalContractors()
  const create = useCreateExternalContractor()
  const remove = useDeleteExternalContractor()
  const [name, setName] = useState('')

  const handleAdd = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    await create.mutateAsync(trimmed)
    setName('')
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div>
        <p className="text-sm font-semibold">Внешние исполнители</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Подрядчики и внешние организации, которых можно назначить блокером задачи.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 h-8 text-sm border rounded px-3 bg-background"
          placeholder="Название / ФИО подрядчика"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Button size="sm" className="h-8" onClick={handleAdd} disabled={!name.trim() || create.isPending}>
          Добавить
        </Button>
      </div>

      {contractors.length === 0 ? (
        <p className="text-xs text-muted-foreground">Список пуст.</p>
      ) : (
        <div className="space-y-1">
          {contractors.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
              <span className="text-sm">{c.name}</span>
              <Button
                variant="ghost" size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => remove.mutate(c.id)}
                disabled={remove.isPending}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface TempAssigneesSectionProps {
  tempAssignees: TempAssignee[]
  tempAssigneesLoading: boolean
  tempAssigneesError: string
  tempAssigneeBusyId: string | null
  tempAssigneeLinkDrafts: Record<string, string>
  setTempAssigneeLinkDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>
  loadTempAssignees: () => void
  handleLinkTempAssignee: (item: TempAssignee) => void
  handleIgnoreTempAssignee: (item: TempAssignee) => void
  handlePromoteTempAssignee: (item: TempAssignee) => void
  users: User[]
}

function TempAssigneesSection({
  tempAssignees,
  tempAssigneesLoading,
  tempAssigneesError,
  tempAssigneeBusyId,
  tempAssigneeLinkDrafts,
  setTempAssigneeLinkDrafts,
  loadTempAssignees,
  handleLinkTempAssignee,
  handleIgnoreTempAssignee,
  handlePromoteTempAssignee,
  users,
}: TempAssigneesSectionProps) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Нераспознанные исполнители из импорта</h2>
        <Button variant="outline" size="sm" onClick={loadTempAssignees} disabled={tempAssigneesLoading}>
          {tempAssigneesLoading ? 'Обновление...' : 'Обновить'}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Исполнители, не сопоставленные с аккаунтом. Их можно связать с существующим сотрудником или завести нового.
      </p>
      {tempAssigneesError && <p className="text-sm text-destructive">{tempAssigneesError}</p>}
      {!tempAssigneesLoading && tempAssignees.length === 0 && (
        <p className="text-sm text-muted-foreground">Нераспознанных исполнителей нет.</p>
      )}
      {!tempAssigneesLoading && tempAssignees.length > 0 && (
        <div className="space-y-2">
          {tempAssignees.map((item) => (
            <div key={item.id} className="rounded border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{item.raw_name}</span>
                <span className="text-muted-foreground">· source: {item.source}</span>
                <span className="text-muted-foreground">· seen: {item.seen_count}</span>
                {item.email && <span className="text-muted-foreground">· {item.email}</span>}
              </div>
              <div className="flex flex-col md:flex-row gap-2 md:items-center">
                <select
                  value={tempAssigneeLinkDrafts[item.id] ?? ''}
                  onChange={(e) => setTempAssigneeLinkDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  className="w-full md:w-80 border rounded px-2 py-2 bg-background text-sm"
                >
                  <option value="">Связать с пользователем...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {formatUserDisplayName(u)} ({u.email})
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleLinkTempAssignee(item)}
                  disabled={!tempAssigneeLinkDrafts[item.id] || tempAssigneeBusyId === item.id}
                >
                  Связать
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handlePromoteTempAssignee(item)}
                  disabled={tempAssigneeBusyId === item.id}
                >
                  Создать сотрудника
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleIgnoreTempAssignee(item)}
                  disabled={tempAssigneeBusyId === item.id}
                >
                  Игнорировать
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
