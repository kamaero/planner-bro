import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { ReportDispatchSettings } from '@/types'
import type { Dispatch, FormEvent, SetStateAction } from 'react'

type DigestChannelKey = 'telegram_projects_slots' | 'telegram_critical_slots' | 'email_analytics_slots'

type TeamReportSettingsSectionProps = {
  canManageTeam: boolean
  reportSettings: ReportDispatchSettings
  reportSettingsLoading: boolean
  reportSettingsSaving: boolean
  reportSettingsMessage: string
  adminDirectiveTestBusy: boolean
  weekdayOptions: ReadonlyArray<{ id: string; label: string }>
  timeWindowOptions: ReadonlyArray<string>
  fixedDigestTimezone: string
  setReportSettings: Dispatch<SetStateAction<ReportDispatchSettings>>
  onSaveReportSettings: (e: FormEvent) => void
  onAdminDirectiveTest: () => void
  updateAdminDirective: (patch: Partial<NonNullable<ReportDispatchSettings['admin_directive']>>) => void
  updateDigestSchedule: (patch: Partial<NonNullable<ReportDispatchSettings['digest_schedule']>>) => void
  getDigestPreset: (channel: DigestChannelKey) => { days: string[]; timeWindow: string }
  updateDigestChannelDays: (channel: DigestChannelKey, days: string[]) => void
  updateDigestChannelWindow: (channel: DigestChannelKey, timeWindow: string) => void
}

export function TeamReportSettingsSection({
  canManageTeam,
  reportSettings,
  reportSettingsLoading,
  reportSettingsSaving,
  reportSettingsMessage,
  adminDirectiveTestBusy,
  weekdayOptions,
  timeWindowOptions,
  fixedDigestTimezone,
  setReportSettings,
  onSaveReportSettings,
  onAdminDirectiveTest,
  updateAdminDirective,
  updateDigestSchedule,
  getDigestPreset,
  updateDigestChannelDays,
  updateDigestChannelWindow,
}: TeamReportSettingsSectionProps) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3 max-w-2xl">
      <h2 className="font-semibold">Настройки рассылки отчетов</h2>
      {!canManageTeam && (
        <p className="text-sm text-muted-foreground">
          Управление рассылкой доступно только менеджерам и администраторам.
        </p>
      )}
      {canManageTeam && (
        <form onSubmit={onSaveReportSettings} className="space-y-3">
          <label className="flex items-center justify-between gap-3 text-sm font-medium">
            <span>SMTP-рассылки включены (глобальный рубильник)</span>
            <Switch
              checked={reportSettings.smtp_enabled}
              onCheckedChange={(checked) =>
                setReportSettings((prev) => ({ ...prev, smtp_enabled: checked }))
              }
              disabled={reportSettingsLoading || reportSettingsSaving}
            />
          </label>
          {!reportSettings.smtp_enabled && (
            <p className="text-xs text-amber-700">
              SMTP выключен: письма не отправляются для всех сценариев (уведомления, сброс пароля, дайджесты).
            </p>
          )}

          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Telegram-дайджесты включены</span>
            <Switch
              checked={reportSettings.telegram_summaries_enabled}
              onCheckedChange={(checked) =>
                setReportSettings((prev) => ({ ...prev, telegram_summaries_enabled: checked }))
              }
              disabled={reportSettingsLoading || reportSettingsSaving}
            />
          </label>

          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Email-дайджесты аналитики включены</span>
            <Switch
              checked={reportSettings.email_analytics_enabled}
              onCheckedChange={(checked) =>
                setReportSettings((prev) => ({ ...prev, email_analytics_enabled: checked }))
              }
              disabled={reportSettingsLoading || reportSettingsSaving}
            />
          </label>

          <div className="space-y-1">
            <Label htmlFor="email-analytics-recipients">Дополнительные получатели email</Label>
            <Input
              id="email-analytics-recipients"
              value={reportSettings.email_analytics_recipients}
              onChange={(e) =>
                setReportSettings((prev) => ({ ...prev, email_analytics_recipients: e.target.value }))
              }
              placeholder="cto@company.ru, pm@company.ru"
              disabled={reportSettingsLoading || reportSettingsSaving}
            />
            <p className="text-xs text-muted-foreground">
              Через запятую. Менеджеры/админы команды добавляются автоматически.
            </p>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-sm font-medium">Директивная рассылка (админ)</p>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Включить директивную рассылку</span>
              <Switch
                checked={reportSettings.admin_directive?.enabled ?? false}
                onCheckedChange={(checked) => updateAdminDirective({ enabled: checked })}
                disabled={reportSettingsLoading || reportSettingsSaving}
              />
            </label>
            <div className="space-y-1">
              <Label htmlFor="admin-directive-recipient">Тестовый/целевой email</Label>
              <Input
                id="admin-directive-recipient"
                value={reportSettings.admin_directive?.recipient ?? 'aerokamero@gmail.com'}
                onChange={(e) => updateAdminDirective({ recipient: e.target.value })}
                disabled={reportSettingsLoading || reportSettingsSaving}
              />
            </div>
            <div className="space-y-1">
              <Label>Дни недели</Label>
              <div className="flex flex-wrap gap-2">
                {weekdayOptions.map((day) => {
                  const checked = (reportSettings.admin_directive?.days ?? []).includes(day.id)
                  return (
                    <label key={day.id} className="flex items-center gap-1 rounded border px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const current = reportSettings.admin_directive?.days ?? []
                          const next = e.target.checked
                            ? Array.from(new Set([...current, day.id]))
                            : current.filter((d) => d !== day.id)
                          updateAdminDirective({ days: next })
                        }}
                        disabled={reportSettingsLoading || reportSettingsSaving}
                      />
                      {day.label}
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="admin-directive-time-window">Интервал отправки</Label>
              <select
                id="admin-directive-time-window"
                value={reportSettings.admin_directive?.time_window ?? '09:00-12:00'}
                onChange={(e) => updateAdminDirective({ time_window: e.target.value })}
                className="w-full border rounded px-2 py-2 bg-background text-sm"
                disabled={reportSettingsLoading || reportSettingsSaving}
              >
                {timeWindowOptions.map((windowOption) => (
                  <option key={windowOption} value={windowOption}>
                    {windowOption}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                В выбранном окне письма ставятся в очередь и отправляются по очереди каждые 5 минут.
              </p>
            </div>
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Просрочки</span>
                <Switch
                  checked={reportSettings.admin_directive?.include_overdue ?? true}
                  onCheckedChange={(checked) => updateAdminDirective({ include_overdue: checked })}
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Без назначений</span>
                <Switch
                  checked={reportSettings.admin_directive?.include_unassigned ?? true}
                  onCheckedChange={(checked) => updateAdminDirective({ include_unassigned: checked })}
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Без движения</span>
                <Switch
                  checked={reportSettings.admin_directive?.include_stale ?? true}
                  onCheckedChange={(checked) => updateAdminDirective({ include_stale: checked })}
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </label>
            </div>
            <div className="space-y-1">
              <Label htmlFor="admin-directive-stale-days">Порог «без движения», дней</Label>
              <Input
                id="admin-directive-stale-days"
                type="number"
                min={1}
                max={90}
                value={reportSettings.admin_directive?.stale_days ?? 7}
                onChange={(e) => updateAdminDirective({ stale_days: Math.max(1, Math.min(90, Number.parseInt(e.target.value || '7', 10))) })}
                disabled={reportSettingsLoading || reportSettingsSaving}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="admin-directive-custom-text">Свободный текст (добавится в письмо)</Label>
              <Input
                id="admin-directive-custom-text"
                value={reportSettings.admin_directive?.custom_text ?? ''}
                onChange={(e) => updateAdminDirective({ custom_text: e.target.value })}
                disabled={reportSettingsLoading || reportSettingsSaving}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={onAdminDirectiveTest}
              disabled={adminDirectiveTestBusy || reportSettingsLoading || reportSettingsSaving}
            >
              {adminDirectiveTestBusy ? 'Отправка теста...' : 'Отправить тест на указанный email'}
            </Button>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-sm font-medium">Расписание и темы дайджестов</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Telegram: тема «Проекты»</span>
                <Switch
                  checked={reportSettings.digest_schedule?.telegram_projects_enabled ?? true}
                  onCheckedChange={(checked) => updateDigestSchedule({ telegram_projects_enabled: checked })}
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Telegram: тема «Критические/СКИ»</span>
                <Switch
                  checked={reportSettings.digest_schedule?.telegram_critical_enabled ?? true}
                  onCheckedChange={(checked) => updateDigestSchedule({ telegram_critical_enabled: checked })}
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Email: тема «Проекты»</span>
                <Switch
                  checked={reportSettings.digest_schedule?.email_projects_enabled ?? true}
                  onCheckedChange={(checked) => updateDigestSchedule({ email_projects_enabled: checked })}
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Email: тема «Критические/СКИ»</span>
                <Switch
                  checked={reportSettings.digest_schedule?.email_critical_enabled ?? true}
                  onCheckedChange={(checked) => updateDigestSchedule({ email_critical_enabled: checked })}
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </label>
            </div>
            {([
              { key: 'telegram_projects_slots', label: 'Telegram проекты' },
              { key: 'telegram_critical_slots', label: 'Telegram критические/СКИ' },
              { key: 'email_analytics_slots', label: 'Email аналитика' },
            ] as Array<{ key: DigestChannelKey; label: string }>).map((channel) => {
              const preset = getDigestPreset(channel.key)
              return (
                <div key={channel.key} className="rounded-md border p-3 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{channel.label}</p>
                    <p className="text-xs text-muted-foreground">Дни недели и интервал отправки</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Дни недели</p>
                    <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                      {weekdayOptions.map((day) => {
                        const checked = preset.days.includes(day.id)
                        return (
                          <label key={`${channel.key}-${day.id}`} className="flex items-center gap-2 rounded border px-2 py-1 text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const nextDays = e.target.checked
                                  ? Array.from(new Set([...preset.days, day.id]))
                                  : preset.days.filter((d) => d !== day.id)
                                updateDigestChannelDays(channel.key, nextDays)
                              }}
                              disabled={reportSettingsLoading || reportSettingsSaving}
                            />
                            {day.label}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${channel.key}-window`}>Интервал отправки</Label>
                    <select
                      id={`${channel.key}-window`}
                      value={preset.timeWindow}
                      onChange={(e) => updateDigestChannelWindow(channel.key, e.target.value)}
                      className="w-full border rounded px-2 py-2 bg-background text-sm"
                      disabled={reportSettingsLoading || reportSettingsSaving}
                    >
                      {timeWindowOptions.map((windowOption) => (
                        <option key={windowOption} value={windowOption}>
                          {windowOption}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
            <p className="text-xs text-muted-foreground">
              Часовой пояс закреплен системно: <code>{fixedDigestTimezone}</code>. Внутри выбранного окна отправка распределяется по очереди.
            </p>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-sm font-medium">Умные фильтры дайджеста</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="digest-deadline-window">Окно по дедлайну (дней)</Label>
                <Input
                  id="digest-deadline-window"
                  type="number"
                  min={0}
                  max={60}
                  value={reportSettings.digest_filters?.deadline_window_days ?? 5}
                  onChange={(e) =>
                    setReportSettings((prev) => ({
                      ...prev,
                      digest_filters: {
                        ...(prev.digest_filters ?? {}),
                        deadline_window_days: Number(e.target.value || 0),
                        priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                        include_control_ski: prev.digest_filters?.include_control_ski ?? true,
                        include_escalations: prev.digest_filters?.include_escalations ?? true,
                        include_without_deadline: prev.digest_filters?.include_without_deadline ?? false,
                        anti_noise_enabled: prev.digest_filters?.anti_noise_enabled ?? true,
                        anti_noise_ttl_minutes: prev.digest_filters?.anti_noise_ttl_minutes ?? 360,
                      },
                    }))
                  }
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="digest-anti-noise-ttl">Анти-шум (минут)</Label>
                <Input
                  id="digest-anti-noise-ttl"
                  type="number"
                  min={15}
                  max={1440}
                  value={reportSettings.digest_filters?.anti_noise_ttl_minutes ?? 360}
                  onChange={(e) =>
                    setReportSettings((prev) => ({
                      ...prev,
                      digest_filters: {
                        ...(prev.digest_filters ?? {}),
                        anti_noise_ttl_minutes: Number(e.target.value || 360),
                        deadline_window_days: prev.digest_filters?.deadline_window_days ?? 5,
                        priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                        include_control_ski: prev.digest_filters?.include_control_ski ?? true,
                        include_escalations: prev.digest_filters?.include_escalations ?? true,
                        include_without_deadline: prev.digest_filters?.include_without_deadline ?? false,
                        anti_noise_enabled: prev.digest_filters?.anti_noise_enabled ?? true,
                      },
                    }))
                  }
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Включать СКИ</span>
                <Switch
                  checked={reportSettings.digest_filters?.include_control_ski ?? true}
                  onCheckedChange={(checked) =>
                    setReportSettings((prev) => ({
                      ...prev,
                      digest_filters: {
                        ...(prev.digest_filters ?? {}),
                        include_control_ski: checked,
                        deadline_window_days: prev.digest_filters?.deadline_window_days ?? 5,
                        priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                        include_escalations: prev.digest_filters?.include_escalations ?? true,
                        include_without_deadline: prev.digest_filters?.include_without_deadline ?? false,
                        anti_noise_enabled: prev.digest_filters?.anti_noise_enabled ?? true,
                        anti_noise_ttl_minutes: prev.digest_filters?.anti_noise_ttl_minutes ?? 360,
                      },
                    }))
                  }
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Включать эскалации</span>
                <Switch
                  checked={reportSettings.digest_filters?.include_escalations ?? true}
                  onCheckedChange={(checked) =>
                    setReportSettings((prev) => ({
                      ...prev,
                      digest_filters: {
                        ...(prev.digest_filters ?? {}),
                        include_escalations: checked,
                        deadline_window_days: prev.digest_filters?.deadline_window_days ?? 5,
                        priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                        include_control_ski: prev.digest_filters?.include_control_ski ?? true,
                        include_without_deadline: prev.digest_filters?.include_without_deadline ?? false,
                        anti_noise_enabled: prev.digest_filters?.anti_noise_enabled ?? true,
                        anti_noise_ttl_minutes: prev.digest_filters?.anti_noise_ttl_minutes ?? 360,
                      },
                    }))
                  }
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Включать задачи без дедлайна</span>
                <Switch
                  checked={reportSettings.digest_filters?.include_without_deadline ?? false}
                  onCheckedChange={(checked) =>
                    setReportSettings((prev) => ({
                      ...prev,
                      digest_filters: {
                        ...(prev.digest_filters ?? {}),
                        include_without_deadline: checked,
                        deadline_window_days: prev.digest_filters?.deadline_window_days ?? 5,
                        priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                        include_control_ski: prev.digest_filters?.include_control_ski ?? true,
                        include_escalations: prev.digest_filters?.include_escalations ?? true,
                        anti_noise_enabled: prev.digest_filters?.anti_noise_enabled ?? true,
                        anti_noise_ttl_minutes: prev.digest_filters?.anti_noise_ttl_minutes ?? 360,
                      },
                    }))
                  }
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Включить анти-шум</span>
                <Switch
                  checked={reportSettings.digest_filters?.anti_noise_enabled ?? true}
                  onCheckedChange={(checked) =>
                    setReportSettings((prev) => ({
                      ...prev,
                      digest_filters: {
                        ...(prev.digest_filters ?? {}),
                        anti_noise_enabled: checked,
                        deadline_window_days: prev.digest_filters?.deadline_window_days ?? 5,
                        priorities: prev.digest_filters?.priorities ?? ['high', 'critical'],
                        include_control_ski: prev.digest_filters?.include_control_ski ?? true,
                        include_escalations: prev.digest_filters?.include_escalations ?? true,
                        include_without_deadline: prev.digest_filters?.include_without_deadline ?? false,
                        anti_noise_ttl_minutes: prev.digest_filters?.anti_noise_ttl_minutes ?? 360,
                      },
                    }))
                  }
                  disabled={reportSettingsLoading || reportSettingsSaving}
                />
              </label>
            </div>
          </div>

          <Button type="submit" disabled={reportSettingsLoading || reportSettingsSaving}>
            {reportSettingsSaving ? 'Сохранение...' : reportSettingsLoading ? 'Загрузка...' : 'Сохранить настройки рассылки'}
          </Button>
          {reportSettingsMessage && (
            <p className="text-sm text-muted-foreground">{reportSettingsMessage}</p>
          )}
        </form>
      )}
    </div>
  )
}
