import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'

type WSEvent = {
  event: string
  data: Record<string, unknown>
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const qc = useQueryClient()
  const accessToken = useAuthStore((s) => s.accessToken)

  const handleMessage = useCallback(
    (evt: MessageEvent) => {
      try {
        const { event, data } = JSON.parse(evt.data) as WSEvent
        switch (event) {
          case 'task_created':
          case 'task_updated':
            qc.invalidateQueries({ queryKey: ['tasks', data.project_id as string] })
            qc.invalidateQueries({ queryKey: ['gantt', data.project_id as string] })
            break
          case 'project_updated':
            qc.invalidateQueries({ queryKey: ['projects'] })
            qc.invalidateQueries({ queryKey: ['projects', data.project_id as string] })
            break
          case 'task_assigned':
          case 'deadline_warning':
            qc.invalidateQueries({ queryKey: ['notifications'] })
            break
        }
      } catch {
        // ignore parse errors
      }
    },
    [qc]
  )

  useEffect(() => {
    if (!accessToken) return

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${protocol}://${window.location.host}/ws?token=${accessToken}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = handleMessage
    ws.onerror = () => {}
    ws.onclose = () => {}

    return () => {
      ws.close()
    }
  }, [accessToken, handleMessage])

  return wsRef
}
