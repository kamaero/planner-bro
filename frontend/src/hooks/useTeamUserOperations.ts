import { useState } from 'react'
import { api } from '@/api/client'
import type { User } from '@/types'
import type { UserDraft } from './useTeamUsersAdminState'
import { formatUserDisplayName } from '@/lib/userName'

interface Params {
  currentUser: User | null | undefined
  setUser: (user: User) => void
  setUsers: React.Dispatch<React.SetStateAction<User[]>>
  setError: (error: string) => void
  permissionDrafts: Record<string, UserDraft>
  setPermissionDrafts: React.Dispatch<React.SetStateAction<Record<string, UserDraft>>>
  nameDrafts: Record<string, { first_name: string; middle_name: string; last_name: string }>
  canCreateSubordinates: boolean | undefined
}

export function useTeamUserOperations({
  currentUser,
  setUser,
  setUsers,
  setError,
  permissionDrafts,
  setPermissionDrafts,
  nameDrafts,
  canCreateSubordinates,
}: Params) {
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [nameBusyId, setNameBusyId] = useState<string | null>(null)
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({})

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

  return {
    busyUserId,
    nameBusyId,
    tempPasswords,
    handleSaveName,
    handleResetPassword,
    handleDeactivate,
    handleSavePermissions,
  }
}
