import { useState } from 'react'
import type { User } from '@/types'

export type UserDraft = Pick<
  User,
  'role' | 'visibility_scope' | 'own_tasks_visibility_enabled' | 'work_email' | 'position_title' | 'manager_id' | 'department_id' | 'can_manage_team' | 'can_delete' | 'can_import' | 'can_bulk_edit'
>

export type InviteDraft = {
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
}

const DEFAULT_INVITE: InviteDraft = {
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
}

export function useTeamUsersAdminState() {
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, UserDraft>>({})
  const [nameDrafts, setNameDrafts] = useState<Record<string, { first_name: string; middle_name: string; last_name: string }>>({})

  const [invite, setInvite] = useState<InviteDraft>(DEFAULT_INVITE)
  const [inviting, setInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [inviteError, setInviteError] = useState('')

  const initializeUserDrafts = (users: User[]) => {
    const permission: Record<string, UserDraft> = {}
    const names: Record<string, { first_name: string; middle_name: string; last_name: string }> = {}
    users.forEach((user) => {
      permission[user.id] = {
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
      names[user.id] = {
        first_name: user.first_name ?? '',
        middle_name: user.middle_name ?? '',
        last_name: user.last_name ?? '',
      }
    })
    setPermissionDrafts(permission)
    setNameDrafts(names)
  }

  const resetInvite = () => setInvite(DEFAULT_INVITE)

  const handleInviteFieldChange = (
    field: keyof InviteDraft,
    value: string | boolean
  ) => {
    setInvite((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleInviteRoleChange = (role: 'developer' | 'manager' | 'admin') => {
    setInvite((prev) => ({
      ...prev,
      role,
      visibility_scope:
        role === 'admin'
          ? 'full_scope'
          : role === 'manager'
            ? 'department_scope'
            : 'own_tasks_only',
    }))
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

  const handleNameDraftChange = (
    userId: string,
    field: 'first_name' | 'middle_name' | 'last_name',
    value: string
  ) => {
    setNameDrafts((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] ?? { first_name: '', middle_name: '', last_name: '' }),
        [field]: value,
      },
    }))
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

  return {
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
    handleInviteFieldChange,
    handleInviteRoleChange,
    handlePermissionChange,
    isPermissionChanged,
    handleNameDraftChange,
    isNameChanged,
  }
}
