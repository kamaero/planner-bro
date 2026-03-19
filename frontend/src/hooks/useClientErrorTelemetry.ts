import { useEffect, useRef } from 'react'
import { api } from '@/api/client'

const TELEMETRY_THROTTLE_MS = 60_000

type ClientErrorPayload = {
  message: string
  stack?: string
  context?: Record<string, unknown>
}

export function useClientErrorTelemetry() {
  const floodGuardRef = useRef<Record<string, number>>({})

  useEffect(() => {
    const reportClientError = (payload: ClientErrorPayload) => {
      const key = `${payload.message}::${payload.stack ?? ''}`.slice(0, 500)
      const now = Date.now()
      const lastReportedAt = floodGuardRef.current[key] ?? 0
      if (now - lastReportedAt < TELEMETRY_THROTTLE_MS) return
      floodGuardRef.current[key] = now

      void api
        .reportClientError({
          message: payload.message,
          stack: payload.stack,
          url: window.location.href,
          user_agent: navigator.userAgent,
          context: payload.context,
        })
        .catch(() => {
          // Telemetry should never break UX.
        })
    }

    const onWindowError = (event: ErrorEvent) => {
      reportClientError({
        message: event.message || 'window.error',
        stack: event.error?.stack,
        context: {
          type: 'window.error',
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      })
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message =
        typeof reason === 'string'
          ? reason
          : typeof reason?.message === 'string'
            ? reason.message
            : 'Unhandled promise rejection'
      const stack = typeof reason?.stack === 'string' ? reason.stack : undefined
      reportClientError({
        message,
        stack,
        context: { type: 'unhandledrejection' },
      })
    }

    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])
}
