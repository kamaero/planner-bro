// Centralized WebSocket event type constants.
// Keep in sync with backend/app/services/events.py

export const WS_EVENTS = {
  TASK_CREATED: 'task_created',
  TASK_UPDATED: 'task_updated',
  TASK_ASSIGNED: 'task_assigned',
  PROJECT_UPDATED: 'project_updated',
  DEADLINE_WARNING: 'deadline_warning',
  ESCALATION_SLA_BREACHED: 'escalation_sla_breached',
  AI_DRAFTS_READY: 'ai_drafts_ready',
  AI_DRAFTS_FAILED: 'ai_drafts_failed',
  TEAM_STATUS_REMINDER: 'team_status_reminder',
  CHAT_MESSAGE: 'chat_message',
} as const

export type WsEventType = (typeof WS_EVENTS)[keyof typeof WS_EVENTS]
