import { useState } from 'react'
import { api } from '@/api/client'

export function useTeamDepartmentCreate(canManageTeam: boolean, onCreated: () => Promise<unknown>) {
  const [newDepartmentName, setNewDepartmentName] = useState('')
  const [newDepartmentParentId, setNewDepartmentParentId] = useState('')
  const [newDepartmentHeadId, setNewDepartmentHeadId] = useState('')
  const [creatingDepartment, setCreatingDepartment] = useState(false)

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
      await onCreated()
    } finally {
      setCreatingDepartment(false)
    }
  }

  return {
    newDepartmentName,
    setNewDepartmentName,
    newDepartmentParentId,
    setNewDepartmentParentId,
    newDepartmentHeadId,
    setNewDepartmentHeadId,
    creatingDepartment,
    handleCreateDepartment,
  }
}
