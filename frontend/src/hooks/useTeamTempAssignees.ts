import { useState } from 'react'
import { api } from '@/api/client'
import type { TempAssignee } from '@/types'

export function useTeamTempAssignees(canManageTeam: boolean, onPromoted: () => Promise<unknown>) {
  const [tempAssignees, setTempAssignees] = useState<TempAssignee[]>([])
  const [tempAssigneesLoading, setTempAssigneesLoading] = useState(false)
  const [tempAssigneesError, setTempAssigneesError] = useState('')
  const [tempAssigneeBusyId, setTempAssigneeBusyId] = useState<string | null>(null)
  const [tempAssigneeLinkDrafts, setTempAssigneeLinkDrafts] = useState<Record<string, string>>({})

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
      await onPromoted()
      await loadTempAssignees()
    } catch (err: any) {
      setTempAssigneesError(err?.response?.data?.detail ?? 'Не удалось создать пользователя из temp')
    } finally {
      setTempAssigneeBusyId(null)
    }
  }

  return {
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
  }
}
