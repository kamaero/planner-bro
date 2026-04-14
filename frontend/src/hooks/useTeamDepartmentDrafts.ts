import { useState } from 'react'
import { api } from '@/api/client'
import type { Department } from '@/types'

export function useTeamDepartmentDrafts(
  canManageTeam: boolean | undefined,
  setError: (error: string) => void,
  onReload: () => Promise<unknown>,
) {
  const [departmentDrafts, setDepartmentDrafts] = useState<
    Record<string, { parent_id: string; head_user_id: string }>
  >({})

  const initializeDepartmentDrafts = (departments: Department[]) => {
    const drafts: Record<string, { parent_id: string; head_user_id: string }> = {}
    departments.forEach((d) => {
      drafts[d.id] = { parent_id: d.parent_id ?? '', head_user_id: d.head_user_id ?? '' }
    })
    setDepartmentDrafts(drafts)
  }

  const handleDepartmentDraftChange = (
    departmentId: string,
    field: 'parent_id' | 'head_user_id',
    value: string,
  ) => {
    setDepartmentDrafts((prev) => ({
      ...prev,
      [departmentId]: {
        ...(prev[departmentId] ?? { parent_id: '', head_user_id: '' }),
        [field]: value,
      },
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
      await onReload()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось обновить отдел')
    }
  }

  const handleDeleteDepartment = async (department: Department) => {
    if (!canManageTeam) return
    if (!window.confirm(`Удалить отдел ${department.name}?`)) return
    try {
      await api.deleteDepartment(department.id)
      await onReload()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось удалить отдел')
    }
  }

  return {
    departmentDrafts,
    initializeDepartmentDrafts,
    handleDepartmentDraftChange,
    handleSaveDepartment,
    handleDeleteDepartment,
  }
}
