import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { useExternalContractors, useCreateExternalContractor, useDeleteExternalContractor } from '@/hooks/useProjects'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { AuthLoginEvent, Department, User, TempAssignee, ReportDispatchSettings } from '@/types'
import { formatUserDisplayName } from '@/lib/userName'
import { useTeamOwnPassword } from '@/hooks/useTeamOwnPassword'
import { useTeamLoginEvents } from '@/hooks/useTeamLoginEvents'

type UserDraft = Pick<
  User,
  'role' | 'visibility_scope' | 'own_tasks_visibility_enabled' | 'work_email' | 'position_title' | 'manager_id' | 'department_id' | 'can_manage_team' | 'can_delete' | 'can_import' | 'can_bulk_edit'
>

const WEEKDAY_OPTIONS = [
  { id: 'mon', label: 'Пн' },
  { id: 'tue', label: 'Вт' },
  { id: 'wed', label: 'Ср' },
  { id: 'thu', label: 'Чт' },
  { id: 'fri', label: 'Пт' },
  { id: 'sat', label: 'Сб' },
  { id: 'sun', label: 'Вс' },
] as const

const TIME_WINDOW_OPTIONS = [
  '06:00-09:00',
  '09:00-12:00',
  '12:00-15:00',
  '15:00-18:00',
] as const

const TIME_WINDOW_START: Record<string, { hour: number; minute: number }> = {
  '06:00-09:00': { hour: 6, minute: 0 },
  '09:00-12:00': { hour: 9, minute: 0 },
  '12:00-15:00': { hour: 12, minute: 0 },
  '15:00-18:00': { hour: 15, minute: 0 },
}

const FIXED_DIGEST_TIMEZONE = 'Asia/Yekaterinburg'
const FALLBACK_TIME_WINDOW = '09:00-12:00'
const ALL_WEEKDAY_IDS = WEEKDAY_OPTIONS.map((d) => d.id)

type DigestChannelKey = 'telegram_projects_slots' | 'telegram_critical_slots' | 'email_analytics_slots'

type DigestChannelPreset = {
  days: string[]
  timeWindow: string
}

const DIGEST_CHANNEL_MINUTE_OFFSET: Record<DigestChannelKey, number> = {
  telegram_projects_slots: 0,
  telegram_critical_slots: 10,
  email_analytics_slots: 20,
}

export function Team() {
  const currentUser = useAuthStore((s) => s.user)
  const canManageTeam = currentUser?.role === 'admin' || currentUser?.can_manage_team
  const canCreateSubordinates = canManageTeam || currentUser?.role === 'manager'

  const [section, setSection] = useState<'overview' | 'users' | 'org' | 'settings' | 'contractors'>('overview')
  const [users, setUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const { loginEvents, loginEventsLoading, loginEventsError, loadLoginEvents } = useTeamLoginEvents(!!canManageTeam)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({})
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, UserDraft>>({})
  const [departmentDrafts, setDepartmentDrafts] = useState<Record<string, { parent_id: string; head_user_id: string }>>({})

  const [invite, setInvite] = useState<{
    first_name: string
    middle_name: string
    last_name: string
    email: string
    work_email: string
    role: 'developer' | 'manager' | 'admin'
    visibility_scope: 'own_tasks_only' | 'department_scope' | 'full_scope'
    own_tasks_visibility_enabled: boolean
    password: string
    position_title: string
    manager_id: string
    department_id: string
  }>({
    first_name: '',
    middle_name: '',
    last_name: '',
    email: '',
    work_email: '',
    role: 'developer',
    visibility_scope: 'own_tasks_only',
    own_tasks_visibility_enabled: true,
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
  const {
    changingOwnPassword,
    ownPasswordSuccess,
    ownPasswordError,
    ownPasswordForm,
    setOwnPasswordForm,
    handleChangeOwnPassword,
  } = useTeamOwnPassword()
  const [reportSettings, setReportSettings] = useState<ReportDispatchSettings>({
    smtp_enabled: true,
    email_test_mode: false,
    email_test_recipient: '',
    telegram_summaries_enabled: true,
    email_analytics_enabled: true,
    email_analytics_recipients: '',
    admin_directive: {
      enabled: false,
      recipient: 'aerokamero@gmail.com',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      time_window: '09:00-12:00',
      include_overdue: true,
      include_stale: true,
      stale_days: 7,
      include_unassigned: true,
      custom_text: '',
    },
    digest_filters: {
      deadline_window_days: 5,
      priorities: ['high', 'critical'],
      include_control_ski: true,
      include_escalations: true,
      include_without_deadline: false,
      anti_noise_enabled: true,
      anti_noise_ttl_minutes: 360,
    },
    digest_schedule: {
      timezone: FIXED_DIGEST_TIMEZONE,
      telegram_projects_enabled: true,
      telegram_critical_enabled: true,
      email_projects_enabled: true,
      email_critical_enabled: true,
      telegram_projects_slots: ['mon@08:00', 'fri@16:00'],
      telegram_critical_slots: ['daily@10:00'],
      email_analytics_slots: ['mon@08:10', 'fri@16:10'],
    },
  })
  const [reportSettingsLoading, setReportSettingsLoading] = useState(false)
  const [reportSettingsSaving, setReportSettingsSaving] = useState(false)
  const [reportSettingsMessage, setReportSettingsMessage] = useState('')
  const [adminDirectiveTestBusy, setAdminDirectiveTestBusy] = useState(false)
  const [tempAssignees, setTempAssignees] = useState<TempAssignee[]>([])
  const [tempAssigneesLoading, setTempAssigneesLoading] = useState(false)
  const [tempAssigneesError, setTempAssigneesError] = useState('')
  const [tempAssigneeBusyId, setTempAssigneeBusyId] = useState<string | null>(null)
  const [tempAssigneeLinkDrafts, setTempAssigneeLinkDrafts] = useState<Record<string, string>>({})

  const [nameDrafts, setNameDrafts] = useState<Record<string, { first_name: string; middle_name: string; last_name: string }>>({})
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
    setLoading(true)
    setError('')
    try {
      const [userData, departmentData] = await Promise.all([api.listUsers(), api.listDepartments()])
      setUsers(userData)
      setDepartments(departmentData)
      const drafts: Record<string, UserDraft> = {}
      const nDrafts: Record<string, { first_name: string; middle_name: string; last_name: string }> = {}
      userData.forEach((user: User) => {
        drafts[user.id] = {
          role: user.role,
          visibility_scope: user.visibility_scope ?? 'department_scope',
          own_tasks_visibility_enabled: user.own_tasks_visibility_enabled ?? true,
          work_email: user.work_email ?? null,
          position_title: user.position_title ?? null,
          manager_id: user.manager_id ?? null,
          department_id: user.department_id ?? null,
          can_manage_team: user.can_manage_team,
          can_delete: user.can_delete,
          can_import: user.can_import,
          can_bulk_edit: user.can_bulk_edit,
        }
        nDrafts[user.id] = {
          first_name: user.first_name ?? '',
          middle_name: user.middle_name ?? '',
          last_name: user.last_name ?? '',
        }
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
      setInvite({
        first_name: '',
        middle_name: '',
        last_name: '',
        email: '',
        work_email: '',
        role: 'developer',
        visibility_scope: 'own_tasks_only',
        own_tasks_visibility_enabled: true,
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

  const isNameChanged = (user: User) => {
    const draft = nameDrafts[user.id]
    if (!draft) return false
    return (
      draft.first_name !== (user.first_name ?? '') ||
      draft.middle_name !== (user.middle_name ?? '') ||
      draft.last_name !== (user.last_name ?? '')
    )
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

  const handlePermissionChange = (userId: string, field: keyof UserDraft, value: string | boolean) => {
    setPermissionDrafts((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] ?? {
          role: 'developer',
          visibility_scope: 'department_scope',
          own_tasks_visibility_enabled: true,
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
      (draft.visibility_scope ?? 'department_scope') !== (user.visibility_scope ?? 'department_scope') ||
      (draft.own_tasks_visibility_enabled ?? true) !== (user.own_tasks_visibility_enabled ?? true) ||
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
            timezone: FIXED_DIGEST_TIMEZONE,
          }
        : undefined
      const saved = await api.updateReportDispatchSettings({
        smtp_enabled: reportSettings.smtp_enabled,
        email_test_mode: reportSettings.email_test_mode,
        email_test_recipient: reportSettings.email_test_recipient,
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

  const detectTimeWindow = (hour: number): string => {
    if (hour >= 6 && hour < 9) return '06:00-09:00'
    if (hour >= 9 && hour < 12) return '09:00-12:00'
    if (hour >= 12 && hour < 15) return '12:00-15:00'
    if (hour >= 15 && hour < 18) return '15:00-18:00'
    return FALLBACK_TIME_WINDOW
  }

  const parseDigestSlotPreset = (slots: string[] | undefined, fallbackWindow = FALLBACK_TIME_WINDOW): DigestChannelPreset => {
    const normalized = (slots ?? []).map((slot) => slot.trim().toLowerCase()).filter(Boolean)
    if (normalized.length === 0) return { days: ['mon', 'fri'], timeWindow: fallbackWindow }

    const hasDaily = normalized.some((slot) => slot.startsWith('daily@'))
    const days = hasDaily
      ? [...ALL_WEEKDAY_IDS]
      : Array.from(
          new Set(
            normalized
              .map((slot) => slot.split('@')[0])
              .filter((day) => ALL_WEEKDAY_IDS.includes(day as (typeof ALL_WEEKDAY_IDS)[number]))
          )
        )

    const firstTime = normalized[0]?.split('@')[1] ?? '09:00'
    const parsedHour = Number.parseInt(firstTime.split(':')[0] ?? '9', 10)
    const timeWindow = Number.isFinite(parsedHour) ? detectTimeWindow(parsedHour) : fallbackWindow

    return {
      days: days.length > 0 ? days : ['mon', 'fri'],
      timeWindow,
    }
  }

  const formatSlotTime = (timeWindow: string, minuteOffset: number): string => {
    const start = TIME_WINDOW_START[timeWindow] ?? TIME_WINDOW_START[FALLBACK_TIME_WINDOW]
    const totalMinutes = start.hour * 60 + start.minute + minuteOffset
    const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, totalMinutes))
    const hour = Math.floor(safeMinutes / 60)
    const minute = safeMinutes % 60
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  const buildDigestSlots = (days: string[], timeWindow: string, minuteOffset: number): string[] => {
    const uniqueDays = Array.from(new Set(days)).filter((day) => ALL_WEEKDAY_IDS.includes(day as (typeof ALL_WEEKDAY_IDS)[number]))
    if (uniqueDays.length === 0) return []
    const time = formatSlotTime(timeWindow, minuteOffset)
    return uniqueDays.map((day) => `${day}@${time}`)
  }

  const getDigestPreset = (channel: DigestChannelKey): DigestChannelPreset => {
    const schedule = reportSettings.digest_schedule
    if (!schedule) return { days: ['mon', 'fri'], timeWindow: FALLBACK_TIME_WINDOW }
    return parseDigestSlotPreset(schedule[channel], FALLBACK_TIME_WINDOW)
  }

  const updateDigestSchedule = (patch: Partial<NonNullable<ReportDispatchSettings['digest_schedule']>>) => {
    setReportSettings((prev) => ({
      ...prev,
      digest_schedule: {
        timezone: FIXED_DIGEST_TIMEZONE,
        telegram_projects_enabled: prev.digest_schedule?.telegram_projects_enabled ?? true,
        telegram_critical_enabled: prev.digest_schedule?.telegram_critical_enabled ?? true,
        email_projects_enabled: prev.digest_schedule?.email_projects_enabled ?? true,
        email_critical_enabled: prev.digest_schedule?.email_critical_enabled ?? true,
        telegram_projects_slots: prev.digest_schedule?.telegram_projects_slots ?? ['mon@08:00', 'fri@16:00'],
        telegram_critical_slots: prev.digest_schedule?.telegram_critical_slots ?? ['daily@10:00'],
        email_analytics_slots: prev.digest_schedule?.email_analytics_slots ?? ['mon@08:10', 'fri@16:10'],
        ...patch,
      },
    }))
  }

  const updateDigestChannelDays = (channel: DigestChannelKey, days: string[]) => {
    const preset = getDigestPreset(channel)
    updateDigestSchedule({
      [channel]: buildDigestSlots(days, preset.timeWindow, DIGEST_CHANNEL_MINUTE_OFFSET[channel]),
    } as Partial<NonNullable<ReportDispatchSettings['digest_schedule']>>)
  }

  const updateDigestChannelWindow = (channel: DigestChannelKey, timeWindow: string) => {
    const preset = getDigestPreset(channel)
    updateDigestSchedule({
      [channel]: buildDigestSlots(preset.days, timeWindow, DIGEST_CHANNEL_MINUTE_OFFSET[channel]),
    } as Partial<NonNullable<ReportDispatchSettings['digest_schedule']>>)
  }

  const updateAdminDirective = (patch: Partial<NonNullable<ReportDispatchSettings['admin_directive']>>) => {
    setReportSettings((prev) => {
      const base = prev.admin_directive ?? {
        enabled: false,
        recipient: 'aerokamero@gmail.com',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        time_window: '09:00-12:00',
        include_overdue: true,
        include_stale: true,
        stale_days: 7,
        include_unassigned: true,
        custom_text: '',
      }
      return {
        ...prev,
        admin_directive: { ...base, ...patch },
      }
    })
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
        <Button variant={section === 'contractors' ? 'default' : 'outline'} onClick={() => setSection('contractors')}>
          Внешние исполнители
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {section === 'overview' && (
        <div className="space-y-4">
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
                      .sort((a, b) =>
                        formatUserDisplayName(a).localeCompare(formatUserDisplayName(b), 'ru')
                      )
                      .map((user) => (
                        <tr key={user.id} className="border-t">
                          <td className="px-3 py-2">
                            <div className="font-medium">{formatUserDisplayName(user)}</div>
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

          {canManageTeam && (
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Журнал входов (аудит)</h2>
                <Button size="sm" variant="outline" onClick={() => void loadLoginEvents()}>
                  Обновить
                </Button>
              </div>
              {loginEventsLoading && <p className="text-sm text-muted-foreground">Загрузка журнала входов...</p>}
              {loginEventsError && <p className="text-sm text-destructive">{loginEventsError}</p>}
              {!loginEventsLoading && !loginEventsError && loginEvents.length === 0 && (
                <p className="text-sm text-muted-foreground">Событий входа пока нет.</p>
              )}
              {!loginEventsLoading && !loginEventsError && loginEvents.length > 0 && (
                <div className="overflow-auto rounded-lg border max-h-[420px]">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/40 text-left sticky top-0">
                      <tr>
                        <th className="px-3 py-2 font-medium">Когда</th>
                        <th className="px-3 py-2 font-medium">Сотрудник</th>
                        <th className="px-3 py-2 font-medium">Email входа</th>
                        <th className="px-3 py-2 font-medium">Тип email</th>
                        <th className="px-3 py-2 font-medium">Результат</th>
                        <th className="px-3 py-2 font-medium">IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loginEvents.map((event) => (
                        <tr key={event.id} className="border-t">
                          <td className="px-3 py-2 text-muted-foreground">{formatDateTime(event.created_at)}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{event.user_name || 'неизвестный пользователь'}</div>
                            <div className="text-xs text-muted-foreground">{event.user_email || '—'}</div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{event.email_entered}</td>
                          <td className="px-3 py-2 text-muted-foreground">{getLoginEmailType(event)}</td>
                          <td className="px-3 py-2">
                            {event.success ? (
                              <span className="text-emerald-600 font-medium">успешно</span>
                            ) : (
                              <span className="text-red-600 font-medium">
                                ошибка{event.failure_reason ? ` (${event.failure_reason})` : ''}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{event.client_ip || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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

          <div className="rounded-xl border bg-card p-4 space-y-2 max-w-2xl">
            <h2 className="font-semibold">Режим видимости задач (заглушка)</h2>
            <p className="text-sm text-muted-foreground">
              Эту настройку переключает ваш руководитель в карточке сотрудника.
            </p>
            <label className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>Фильтр "только свои задачи"</span>
              <Switch
                checked={currentUser?.own_tasks_visibility_enabled ?? true}
                onCheckedChange={() => {}}
                disabled
              />
            </label>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Temp-исполнители из файлов</h2>
              <Button variant="outline" size="sm" onClick={() => void loadTempAssignees()} disabled={tempAssigneesLoading}>
                {tempAssigneesLoading ? 'Обновление...' : 'Обновить'}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Нераспознанные исполнители из импорта. Их можно связать с существующим аккаунтом или завести как нового сотрудника.
            </p>
            {tempAssigneesError && <p className="text-sm text-destructive">{tempAssigneesError}</p>}
            {!tempAssigneesLoading && tempAssignees.length === 0 && (
              <p className="text-sm text-muted-foreground">Пока нет нераспознанных исполнителей.</p>
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
                        onClick={() => void handleLinkTempAssignee(item)}
                        disabled={!tempAssigneeLinkDrafts[item.id] || tempAssigneeBusyId === item.id}
                      >
                        Связать
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handlePromoteTempAssignee(item)}
                        disabled={tempAssigneeBusyId === item.id}
                      >
                        Создать пользователя
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleIgnoreTempAssignee(item)}
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

          <div className="rounded-xl border bg-card p-4 space-y-3 max-w-2xl">
            <h2 className="font-semibold">Настройки рассылки отчетов</h2>
            {!canManageTeam && (
              <p className="text-sm text-muted-foreground">
                Управление рассылкой доступно только менеджерам и администраторам.
              </p>
            )}
            {canManageTeam && (
              <form onSubmit={handleSaveReportSettings} className="space-y-3">
                <label className="flex items-center justify-between gap-3 text-sm font-medium">
                  <span>SMTP-рассылки включены (глобальный рубильник)</span>
                  <Switch
                    checked={reportSettings.smtp_enabled}
                    onCheckedChange={(checked) =>
                      setReportSettings((prev) => ({ ...prev, smtp_enabled: checked }))
                    }
                    disabled={reportSettingsLoading || reportSettingsSaving}
                  />
                </label>
                {!reportSettings.smtp_enabled && (
                  <p className="text-xs text-amber-700">
                    SMTP выключен: письма не отправляются для всех сценариев (уведомления, сброс пароля, дайджесты).
                  </p>
                )}

                <label className="flex items-center justify-between gap-3 text-sm font-medium">
                  <span>Тест-режим (все письма → один адрес)</span>
                  <Switch
                    checked={reportSettings.email_test_mode ?? false}
                    onCheckedChange={(checked) =>
                      setReportSettings((prev) => ({ ...prev, email_test_mode: checked }))
                    }
                    disabled={reportSettingsLoading || reportSettingsSaving}
                  />
                </label>
                {reportSettings.email_test_mode && (
                  <div className="space-y-1">
                    <p className="text-xs text-blue-700">
                      Тест-режим включён: все исходящие письма (любые сценарии) будут перенаправлены на один адрес.
                    </p>
                    <input
                      type="email"
                      className="w-full rounded border px-2 py-1 text-sm"
                      placeholder="aerokamero@gmail.com"
                      value={reportSettings.email_test_recipient ?? ''}
                      onChange={(e) =>
                        setReportSettings((prev) => ({ ...prev, email_test_recipient: e.target.value }))
                      }
                      disabled={reportSettingsLoading || reportSettingsSaving}
                    />
                  </div>
                )}

                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Telegram-дайджесты включены</span>
                  <Switch
                    checked={reportSettings.telegram_summaries_enabled}
                    onCheckedChange={(checked) =>
                      setReportSettings((prev) => ({ ...prev, telegram_summaries_enabled: checked }))
                    }
                    disabled={reportSettingsLoading || reportSettingsSaving}
                  />
                </label>

                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Email-дайджесты аналитики включены</span>
                  <Switch
                    checked={reportSettings.email_analytics_enabled}
                    onCheckedChange={(checked) =>
                      setReportSettings((prev) => ({ ...prev, email_analytics_enabled: checked }))
                    }
                    disabled={reportSettingsLoading || reportSettingsSaving}
                  />
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
                  <p className="text-sm font-medium">Директивная рассылка (админ)</p>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Включить директивную рассылку</span>
                    <Switch
                      checked={reportSettings.admin_directive?.enabled ?? false}
                      onCheckedChange={(checked) => updateAdminDirective({ enabled: checked })}
                      disabled={reportSettingsLoading || reportSettingsSaving}
                    />
                  </label>
                  <div className="space-y-1">
                    <Label htmlFor="admin-directive-recipient">Тестовый/целевой email</Label>
                    <Input
                      id="admin-directive-recipient"
                      value={reportSettings.admin_directive?.recipient ?? 'aerokamero@gmail.com'}
                      onChange={(e) => updateAdminDirective({ recipient: e.target.value })}
                      disabled={reportSettingsLoading || reportSettingsSaving}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Дни недели</Label>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAY_OPTIONS.map((day) => {
                        const checked = (reportSettings.admin_directive?.days ?? []).includes(day.id)
                        return (
                          <label key={day.id} className="flex items-center gap-1 rounded border px-2 py-1 text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const current = reportSettings.admin_directive?.days ?? []
                                const next = e.target.checked
                                  ? Array.from(new Set([...current, day.id]))
                                  : current.filter((d) => d !== day.id)
                                updateAdminDirective({ days: next })
                              }}
                              disabled={reportSettingsLoading || reportSettingsSaving}
                            />
                            {day.label}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="admin-directive-time-window">Интервал отправки</Label>
                    <select
                      id="admin-directive-time-window"
                      value={reportSettings.admin_directive?.time_window ?? '09:00-12:00'}
                      onChange={(e) => updateAdminDirective({ time_window: e.target.value })}
                      className="w-full border rounded px-2 py-2 bg-background text-sm"
                      disabled={reportSettingsLoading || reportSettingsSaving}
                    >
                      {TIME_WINDOW_OPTIONS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      В выбранном окне письма ставятся в очередь и отправляются по очереди каждые 5 минут.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Просрочки</span>
                      <Switch
                        checked={reportSettings.admin_directive?.include_overdue ?? true}
                        onCheckedChange={(checked) => updateAdminDirective({ include_overdue: checked })}
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Без назначений</span>
                      <Switch
                        checked={reportSettings.admin_directive?.include_unassigned ?? true}
                        onCheckedChange={(checked) => updateAdminDirective({ include_unassigned: checked })}
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Без движения</span>
                      <Switch
                        checked={reportSettings.admin_directive?.include_stale ?? true}
                        onCheckedChange={(checked) => updateAdminDirective({ include_stale: checked })}
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                    </label>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="admin-directive-stale-days">Порог «без движения», дней</Label>
                    <Input
                      id="admin-directive-stale-days"
                      type="number"
                      min={1}
                      max={90}
                      value={reportSettings.admin_directive?.stale_days ?? 7}
                      onChange={(e) => updateAdminDirective({ stale_days: Math.max(1, Math.min(90, Number.parseInt(e.target.value || '7', 10))) })}
                      disabled={reportSettingsLoading || reportSettingsSaving}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="admin-directive-custom-text">Свободный текст (добавится в письмо)</Label>
                    <Input
                      id="admin-directive-custom-text"
                      value={reportSettings.admin_directive?.custom_text ?? ''}
                      onChange={(e) => updateAdminDirective({ custom_text: e.target.value })}
                      disabled={reportSettingsLoading || reportSettingsSaving}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAdminDirectiveTest}
                    disabled={adminDirectiveTestBusy || reportSettingsLoading || reportSettingsSaving}
                  >
                    {adminDirectiveTestBusy ? 'Отправка теста...' : 'Отправить тест на указанный email'}
                  </Button>
                </div>

                <div className="rounded-lg border p-3 space-y-3">
                  <p className="text-sm font-medium">Расписание и темы дайджестов</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Telegram: тема «Проекты»</span>
                      <Switch
                        checked={reportSettings.digest_schedule?.telegram_projects_enabled ?? true}
                        onCheckedChange={(checked) => updateDigestSchedule({ telegram_projects_enabled: checked })}
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Telegram: тема «Критические/СКИ»</span>
                      <Switch
                        checked={reportSettings.digest_schedule?.telegram_critical_enabled ?? true}
                        onCheckedChange={(checked) => updateDigestSchedule({ telegram_critical_enabled: checked })}
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Email: тема «Проекты»</span>
                      <Switch
                        checked={reportSettings.digest_schedule?.email_projects_enabled ?? true}
                        onCheckedChange={(checked) => updateDigestSchedule({ email_projects_enabled: checked })}
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Email: тема «Критические/СКИ»</span>
                      <Switch
                        checked={reportSettings.digest_schedule?.email_critical_enabled ?? true}
                        onCheckedChange={(checked) => updateDigestSchedule({ email_critical_enabled: checked })}
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                    </label>
                  </div>
                  {([
                    { key: 'telegram_projects_slots', label: 'Telegram проекты' },
                    { key: 'telegram_critical_slots', label: 'Telegram критические/СКИ' },
                    { key: 'email_analytics_slots', label: 'Email аналитика' },
                  ] as Array<{ key: DigestChannelKey; label: string }>).map((channel) => {
                    const preset = getDigestPreset(channel.key)
                    return (
                      <div key={channel.key} className="rounded-md border p-3 space-y-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{channel.label}</p>
                          <p className="text-xs text-muted-foreground">Дни недели и интервал отправки</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium">Дни недели</p>
                          <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                            {WEEKDAY_OPTIONS.map((day) => {
                              const checked = preset.days.includes(day.id)
                              return (
                                <label key={`${channel.key}-${day.id}`} className="flex items-center gap-2 rounded border px-2 py-1 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const nextDays = e.target.checked
                                        ? Array.from(new Set([...preset.days, day.id]))
                                        : preset.days.filter((d) => d !== day.id)
                                      updateDigestChannelDays(channel.key, nextDays)
                                    }}
                                    disabled={reportSettingsLoading || reportSettingsSaving}
                                  />
                                  {day.label}
                                </label>
                              )
                            })}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${channel.key}-window`}>Интервал отправки</Label>
                          <select
                            id={`${channel.key}-window`}
                            value={preset.timeWindow}
                            onChange={(e) => updateDigestChannelWindow(channel.key, e.target.value)}
                            className="w-full border rounded px-2 py-2 bg-background text-sm"
                            disabled={reportSettingsLoading || reportSettingsSaving}
                          >
                            {TIME_WINDOW_OPTIONS.map((w) => (
                              <option key={w} value={w}>
                                {w}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )
                  })}
                  <p className="text-xs text-muted-foreground">
                    Часовой пояс закреплен системно: <code>{FIXED_DIGEST_TIMEZONE}</code>. Внутри выбранного окна отправка распределяется по очереди.
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
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Включать СКИ</span>
                      <Switch
                        checked={reportSettings.digest_filters?.include_control_ski ?? true}
                        onCheckedChange={(checked) =>
                          setReportSettings((prev) => ({
                            ...prev,
                            digest_filters: {
                              ...(prev.digest_filters ?? {}),
                              include_control_ski: checked,
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
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Включать эскалации</span>
                      <Switch
                        checked={reportSettings.digest_filters?.include_escalations ?? true}
                        onCheckedChange={(checked) =>
                          setReportSettings((prev) => ({
                            ...prev,
                            digest_filters: {
                              ...(prev.digest_filters ?? {}),
                              include_escalations: checked,
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
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Включать задачи без дедлайна</span>
                      <Switch
                        checked={reportSettings.digest_filters?.include_without_deadline ?? false}
                        onCheckedChange={(checked) =>
                          setReportSettings((prev) => ({
                            ...prev,
                            digest_filters: {
                              ...(prev.digest_filters ?? {}),
                              include_without_deadline: checked,
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
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>Включить анти-шум</span>
                      <Switch
                        checked={reportSettings.digest_filters?.anti_noise_enabled ?? true}
                        onCheckedChange={(checked) =>
                          setReportSettings((prev) => ({
                            ...prev,
                            digest_filters: {
                              ...(prev.digest_filters ?? {}),
                              anti_noise_enabled: checked,
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

      {section === 'contractors' && <ExternalContractorsSection />}
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

      {/* Add form */}
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

      {/* List */}
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
