import { useState } from 'react'
import { api } from '@/api/client'
import type { AuthLoginEvent } from '@/types'

export function useTeamLoginEvents(canManageTeam: boolean) {
  const [loginEvents, setLoginEvents] = useState<AuthLoginEvent[]>([])
  const [loginEventsLoading, setLoginEventsLoading] = useState(false)
  const [loginEventsError, setLoginEventsError] = useState('')

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

  return { loginEvents, loginEventsLoading, loginEventsError, loadLoginEvents }
}
