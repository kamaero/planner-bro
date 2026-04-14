import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { AuthLoginEvent, Department, User } from '@/types'
import { formatUserDisplayName } from '@/lib/userName'
import { useTeamOwnPassword } from '@/hooks/useTeamOwnPassword'
import { useTeamLoginEvents } from '@/hooks/useTeamLoginEvents'
import { useTeamTempAssignees } from '@/hooks/useTeamTempAssignees'
import { useTeamDepartmentCreate } from '@/hooks/useTeamDepartmentCreate'
import { useTeamDepartmentDrafts } from '@/hooks/useTeamDepartmentDrafts'
import { useTeamUsersAdminState } from '@/hooks/useTeamUsersAdminState'
import { useTeamUserOperations } from '@/hooks/useTeamUserOperations'
import { useTeamReportSettings } from '@/hooks/useTeamReportSettings'
import { useTeamCoreData } from '@/hooks/useTeamCoreData'
import { TeamOverviewSection } from '@/components/Team/TeamOverviewSection'
import { TeamOrgSection } from '@/components/Team/TeamOrgSection'
import { TeamUsersSection } from '@/components/Team/TeamUsersSection'
import { TeamSettingsSection } from '@/components/Team/TeamSettingsSection'
import { ExternalContractorsSection } from '@/components/Team/ExternalContractorsSection'
import { TempAssigneesSection } from '@/components/Team/TempAssigneesSection'

export function Team() {
  const { user: currentUser, setUser } = useAuthStore()
  const canManageTeam = currentUser?.role === 'admin' || currentUser?.can_manage_team
  const canCreateSubordinates = canManageTeam || currentUser?.role === 'manager'

  const [section, setSection] = useState<'org' | 'mailing' | 'profile'>('org')
  const { users, setUsers, departments, loading, error, setError, loadAll: loadCoreData } = useTeamCoreData()
  const { loginEvents, loginEventsLoading, loginEventsError, loadLoginEvents } = useTeamLoginEvents(!!canManageTeam)

  const adminState = useTeamUsersAdminState()
  const { permissionDrafts, setPermissionDrafts, nameDrafts, setNameDrafts,
    initializeUserDrafts, invite, setInvite, resetInvite, inviting, setInviting,
    inviteSuccess, setInviteSuccess, inviteError, setInviteError,
    handlePermissionChange, isPermissionChanged, isNameChanged } = adminState

  const {
    changingOwnPassword, ownPasswordSuccess, ownPasswordError,
    ownPasswordForm, setOwnPasswordForm, handleChangeOwnPassword,
  } = useTeamOwnPassword()

  const {
    reportSettings, setReportSettings, weekdayOptions, timeWindowOptions,
    fixedDigestTimezone, getDigestPreset, updateDigestSchedule,
    updateDigestChannelDays, updateDigestChannelWindow, updateAdminDirective,
    reportSettingsLoading, reportSettingsSaving, reportSettingsMessage,
    adminDirectiveTestBusy, loadReportSettings, handleSaveReportSettings, handleAdminDirectiveTest,
  } = useTeamReportSettings()

  const loadAllRef = useRef<() => Promise<unknown>>(() => Promise.resolve())

  const { tempAssignees, tempAssigneesLoading, tempAssigneesError, tempAssigneeBusyId,
    tempAssigneeLinkDrafts, setTempAssigneeLinkDrafts, loadTempAssignees,
    handleLinkTempAssignee, handleIgnoreTempAssignee, handlePromoteTempAssignee,
  } = useTeamTempAssignees(!!canManageTeam, () => loadAllRef.current())

  const { newDepartmentName, setNewDepartmentName, newDepartmentParentId,
    setNewDepartmentParentId, newDepartmentHeadId, setNewDepartmentHeadId,
    creatingDepartment, handleCreateDepartment,
  } = useTeamDepartmentCreate(!!canManageTeam, () => loadAllRef.current())

  const { departmentDrafts, initializeDepartmentDrafts, handleDepartmentDraftChange,
    handleSaveDepartment, handleDeleteDepartment,
  } = useTeamDepartmentDrafts(canManageTeam, setError, () => loadAllRef.current())

  const { busyUserId, nameBusyId, tempPasswords,
    handleSaveName, handleResetPassword, handleDeactivate, handleSavePermissions,
  } = useTeamUserOperations({
    currentUser, setUser, setUsers, setError,
    permissionDrafts, setPermissionDrafts, nameDrafts,
    canCreateSubordinates,
  })

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
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(dt)
  }

  const getLoginEmailType = (event: AuthLoginEvent) => {
    const user = usersById[event.user_id ?? '']
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
    initializeDepartmentDrafts(result.departments)
  }

  loadAllRef.current = loadAll

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

  useEffect(() => { void loadAll() }, [])

  useEffect(() => {
    if (section !== 'org' || !canManageTeam) return
    void loadLoginEvents()
    void loadTempAssignees()
  }, [section, canManageTeam])

  useEffect(() => {
    if (section !== 'mailing' || !canManageTeam) return
    void loadReportSettings(canManageTeam)
  }, [section, canManageTeam])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Настройки</h1>
        <p className="text-sm text-muted-foreground">Оргструктура, рассылки и профиль.</p>
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
          handleSaveReportSettings={(e) => void handleSaveReportSettings(e, canManageTeam)}
          handleAdminDirectiveTest={() => void handleAdminDirectiveTest(canManageTeam)}
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

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <h2 className="font-semibold">Персональная email-рассылка</h2>
            <div className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <div>
                <div>Email-уведомления</div>
                <div className="text-xs text-muted-foreground">Назначения задач, дедлайны, напоминания</div>
              </div>
              <Switch
                checked={currentUser?.email_notifications_enabled ?? true}
                onCheckedChange={async (checked) => {
                  try {
                    const updated = await api.updateMe({ email_notifications_enabled: checked })
                    setUser(updated)
                  } catch {
                    // ignore
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
