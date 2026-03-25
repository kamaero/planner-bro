import { useState } from 'react'
import { api } from '@/api/client'
import type { Department, User } from '@/types'

export function useTeamCoreData() {
  const [users, setUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [userData, departmentData] = await Promise.all([api.listUsers(), api.listDepartments()])
      setUsers(userData)
      setDepartments(departmentData)
      return { users: userData as User[], departments: departmentData as Department[] }
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Не удалось загрузить данные команды')
      return null
    } finally {
      setLoading(false)
    }
  }

  return { users, setUsers, departments, loading, error, setError, loadAll }
}
