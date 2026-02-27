import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { WS_EVENTS } from '@/api/events'

type WSEvent = {
  event: string
  data: Record<string, unknown>
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const qc = useQueryClient()
  const accessToken = useAuthStore((s) => s.accessToken)
  const retryRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const heartbeatTimerRef = useRef<number | null>(null)
  const activeRef = useRef(false)

  const handleMessage = useCallback(
    (evt: MessageEvent) => {
      try {
        const { event, data } = JSON.parse(evt.data) as WSEvent
        switch (event) {
          case WS_EVENTS.TASK_CREATED:
          case WS_EVENTS.TASK_UPDATED:
            qc.invalidateQueries({ queryKey: ['tasks', data.project_id as string] })
            qc.invalidateQueries({ queryKey: ['gantt', data.project_id as string] })
            qc.invalidateQueries({ queryKey: ['notifications'] })
            break
          case WS_EVENTS.PROJECT_UPDATED:
            qc.invalidateQueries({ queryKey: ['projects'] })
            qc.invalidateQueries({ queryKey: ['projects', data.project_id as string] })
            qc.invalidateQueries({ queryKey: ['notifications'] })
            break
          case WS_EVENTS.TASK_ASSIGNED:
          case WS_EVENTS.DEADLINE_WARNING:
            qc.invalidateQueries({ queryKey: ['notifications'] })
            break
          case WS_EVENTS.AI_DRAFTS_READY:
          case WS_EVENTS.AI_DRAFTS_FAILED:
            qc.invalidateQueries({ queryKey: ['ai-jobs'] })
            qc.invalidateQueries({ queryKey: ['ai-drafts'] })
            break
          case WS_EVENTS.CHAT_MESSAGE:
            qc.invalidateQueries({ queryKey: ['chat', 'global'] })
            qc.invalidateQueries({ queryKey: ['chat', 'direct'] })
            break
        }
      } catch {
        // ignore parse errors
      }
    },
    [qc]
  )

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (heartbeatTimerRef.current != null) {
      window.clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (!activeRef.current) return
    if (reconnectTimerRef.current != null) return

    const attempt = retryRef.current
    const base = Math.min(30_000, 1_000 * 2 ** attempt)
    const jitter = Math.floor(Math.random() * 500)
    const delay = base + jitter
    retryRef.current = Math.min(attempt + 1, 6)

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null
      if (!activeRef.current) return
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl = `${protocol}://${window.location.host}/ws?token=${accessToken}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        retryRef.current = 0
        if (heartbeatTimerRef.current == null) {
          heartbeatTimerRef.current = window.setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send('ping')
              } catch {
                // ignore
              }
            }
          }, 25_000)
        }
      }
      ws.onmessage = handleMessage
      ws.onerror = () => {}
      ws.onclose = () => {
        clearTimers()
        scheduleReconnect()
      }
    }, delay)
  }, [accessToken, clearTimers, handleMessage])

  useEffect(() => {
    if (!accessToken) return

    activeRef.current = true

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${protocol}://${window.location.host}/ws?token=${accessToken}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = handleMessage
    ws.onerror = () => {}
    ws.onopen = () => {
      retryRef.current = 0
      clearTimers()
      heartbeatTimerRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send('ping')
          } catch {
            // ignore
          }
        }
      }, 25_000)
    }
    ws.onclose = () => {
      clearTimers()
      scheduleReconnect()
    }

    return () => {
      activeRef.current = false
      clearTimers()
      ws.close()
    }
  }, [accessToken, clearTimers, handleMessage, scheduleReconnect])

  return wsRef
}
