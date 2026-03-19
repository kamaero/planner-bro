import { useState } from 'react'
import type { ReportDispatchSettings } from '@/types'

export const TEAM_WEEKDAY_OPTIONS = [
  { id: 'mon', label: 'Пн' },
  { id: 'tue', label: 'Вт' },
  { id: 'wed', label: 'Ср' },
  { id: 'thu', label: 'Чт' },
  { id: 'fri', label: 'Пт' },
  { id: 'sat', label: 'Сб' },
  { id: 'sun', label: 'Вс' },
] as const

export const TEAM_TIME_WINDOW_OPTIONS = [
  '06:00-09:00',
  '09:00-12:00',
  '12:00-15:00',
  '15:00-18:00',
] as const

export const TEAM_FIXED_DIGEST_TIMEZONE = 'Asia/Yekaterinburg'

const TEAM_FALLBACK_TIME_WINDOW = '09:00-12:00'
const ALL_WEEKDAY_IDS = TEAM_WEEKDAY_OPTIONS.map((d) => d.id)

type DigestChannelKey = 'telegram_projects_slots' | 'telegram_critical_slots' | 'email_analytics_slots'

type DigestChannelPreset = {
  days: string[]
  timeWindow: string
}

const DIGEST_CHANNEL_MINUTE_OFFSET: Record<DigestChannelKey, number> = {
  telegram_projects_slots: 0,
  telegram_critical_slots: 10,
  email_analytics_slots: 20,
}

const TIME_WINDOW_START: Record<string, { hour: number; minute: number }> = {
  '06:00-09:00': { hour: 6, minute: 0 },
  '09:00-12:00': { hour: 9, minute: 0 },
  '12:00-15:00': { hour: 12, minute: 0 },
  '15:00-18:00': { hour: 15, minute: 0 },
}

export function useTeamReportSettings() {
  const [reportSettings, setReportSettings] = useState<ReportDispatchSettings>({
    smtp_enabled: true,
    telegram_summaries_enabled: true,
    email_analytics_enabled: true,
    email_analytics_recipients: '',
    admin_directive: {
      enabled: false,
      recipient: 'aerokamero@gmail.com',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      time_window: '09:00-12:00',
      include_overdue: true,
      include_stale: true,
      stale_days: 7,
      include_unassigned: true,
      custom_text: '',
    },
    digest_filters: {
      deadline_window_days: 5,
      priorities: ['high', 'critical'],
      include_control_ski: true,
      include_escalations: true,
      include_without_deadline: false,
      anti_noise_enabled: true,
      anti_noise_ttl_minutes: 360,
    },
    digest_schedule: {
      timezone: TEAM_FIXED_DIGEST_TIMEZONE,
      telegram_projects_enabled: true,
      telegram_critical_enabled: true,
      email_projects_enabled: true,
      email_critical_enabled: true,
      telegram_projects_slots: ['mon@08:00', 'fri@16:00'],
      telegram_critical_slots: ['daily@10:00'],
      email_analytics_slots: ['mon@08:10', 'fri@16:10'],
    },
  })

  const detectTimeWindow = (hour: number): string => {
    if (hour >= 6 && hour < 9) return '06:00-09:00'
    if (hour >= 9 && hour < 12) return '09:00-12:00'
    if (hour >= 12 && hour < 15) return '12:00-15:00'
    if (hour >= 15 && hour < 18) return '15:00-18:00'
    return TEAM_FALLBACK_TIME_WINDOW
  }

  const parseDigestSlotPreset = (slots: string[] | undefined, fallbackWindow = TEAM_FALLBACK_TIME_WINDOW): DigestChannelPreset => {
    const normalized = (slots ?? []).map((slot) => slot.trim().toLowerCase()).filter(Boolean)
    if (normalized.length === 0) return { days: ['mon', 'fri'], timeWindow: fallbackWindow }

    const hasDaily = normalized.some((slot) => slot.startsWith('daily@'))
    const days = hasDaily
      ? [...ALL_WEEKDAY_IDS]
      : Array.from(
          new Set(
            normalized
              .map((slot) => slot.split('@')[0])
              .filter((day) => ALL_WEEKDAY_IDS.includes(day as (typeof ALL_WEEKDAY_IDS)[number]))
          )
        )

    const firstTime = normalized[0]?.split('@')[1] ?? '09:00'
    const parsedHour = Number.parseInt(firstTime.split(':')[0] ?? '9', 10)
    const timeWindow = Number.isFinite(parsedHour) ? detectTimeWindow(parsedHour) : fallbackWindow

    return {
      days: days.length > 0 ? days : ['mon', 'fri'],
      timeWindow,
    }
  }

  const formatSlotTime = (timeWindow: string, minuteOffset: number): string => {
    const start = TIME_WINDOW_START[timeWindow] ?? TIME_WINDOW_START[TEAM_FALLBACK_TIME_WINDOW]
    const totalMinutes = start.hour * 60 + start.minute + minuteOffset
    const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, totalMinutes))
    const hour = Math.floor(safeMinutes / 60)
    const minute = safeMinutes % 60
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  const buildDigestSlots = (days: string[], timeWindow: string, minuteOffset: number): string[] => {
    const uniqueDays = Array.from(new Set(days)).filter((day) => ALL_WEEKDAY_IDS.includes(day as (typeof ALL_WEEKDAY_IDS)[number]))
    if (uniqueDays.length === 0) return []
    const time = formatSlotTime(timeWindow, minuteOffset)
    return uniqueDays.map((day) => `${day}@${time}`)
  }

  const getDigestPreset = (channel: DigestChannelKey): DigestChannelPreset => {
    const schedule = reportSettings.digest_schedule
    if (!schedule) return { days: ['mon', 'fri'], timeWindow: TEAM_FALLBACK_TIME_WINDOW }
    return parseDigestSlotPreset(schedule[channel], TEAM_FALLBACK_TIME_WINDOW)
  }

  const updateDigestSchedule = (patch: Partial<NonNullable<ReportDispatchSettings['digest_schedule']>>) => {
    setReportSettings((prev) => ({
      ...prev,
      digest_schedule: {
        timezone: TEAM_FIXED_DIGEST_TIMEZONE,
        telegram_projects_enabled: prev.digest_schedule?.telegram_projects_enabled ?? true,
        telegram_critical_enabled: prev.digest_schedule?.telegram_critical_enabled ?? true,
        email_projects_enabled: prev.digest_schedule?.email_projects_enabled ?? true,
        email_critical_enabled: prev.digest_schedule?.email_critical_enabled ?? true,
        telegram_projects_slots: prev.digest_schedule?.telegram_projects_slots ?? ['mon@08:00', 'fri@16:00'],
        telegram_critical_slots: prev.digest_schedule?.telegram_critical_slots ?? ['daily@10:00'],
        email_analytics_slots: prev.digest_schedule?.email_analytics_slots ?? ['mon@08:10', 'fri@16:10'],
        ...patch,
      },
    }))
  }

  const updateDigestChannelDays = (channel: DigestChannelKey, days: string[]) => {
    const preset = getDigestPreset(channel)
    updateDigestSchedule({
      [channel]: buildDigestSlots(days, preset.timeWindow, DIGEST_CHANNEL_MINUTE_OFFSET[channel]),
    } as Partial<NonNullable<ReportDispatchSettings['digest_schedule']>>)
  }

  const updateDigestChannelWindow = (channel: DigestChannelKey, timeWindow: string) => {
    const preset = getDigestPreset(channel)
    updateDigestSchedule({
      [channel]: buildDigestSlots(preset.days, timeWindow, DIGEST_CHANNEL_MINUTE_OFFSET[channel]),
    } as Partial<NonNullable<ReportDispatchSettings['digest_schedule']>>)
  }

  const updateAdminDirective = (patch: Partial<NonNullable<ReportDispatchSettings['admin_directive']>>) => {
    setReportSettings((prev) => {
      const base = prev.admin_directive ?? {
        enabled: false,
        recipient: 'aerokamero@gmail.com',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        time_window: '09:00-12:00',
        include_overdue: true,
        include_stale: true,
        stale_days: 7,
        include_unassigned: true,
        custom_text: '',
      }
      return {
        ...prev,
        admin_directive: { ...base, ...patch },
      }
    })
  }

  return {
    reportSettings,
    setReportSettings,
    weekdayOptions: TEAM_WEEKDAY_OPTIONS,
    timeWindowOptions: TEAM_TIME_WINDOW_OPTIONS,
    fixedDigestTimezone: TEAM_FIXED_DIGEST_TIMEZONE,
    getDigestPreset,
    updateDigestSchedule,
    updateDigestChannelDays,
    updateDigestChannelWindow,
    updateAdminDirective,
  }
}
