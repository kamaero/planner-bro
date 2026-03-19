import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { FormEvent } from 'react'

type OwnPasswordForm = {
  current_password: string
  new_password: string
}

type TeamSettingsAccountSectionProps = {
  ownPasswordForm: OwnPasswordForm
  changingOwnPassword: boolean
  ownPasswordSuccess: string
  ownPasswordError: string
  ownTasksVisibilityEnabled: boolean
  onChangeOwnPassword: (e: FormEvent) => void
  onOwnPasswordFieldChange: (field: keyof OwnPasswordForm, value: string) => void
}

export function TeamSettingsAccountSection({
  ownPasswordForm,
  changingOwnPassword,
  ownPasswordSuccess,
  ownPasswordError,
  ownTasksVisibilityEnabled,
  onChangeOwnPassword,
  onOwnPasswordFieldChange,
}: TeamSettingsAccountSectionProps) {
  return (
    <>
      <div className="rounded-xl border bg-card p-4 space-y-3 max-w-2xl">
        <h2 className="font-semibold">Сменить свой пароль</h2>
        <form onSubmit={onChangeOwnPassword} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="current-password">Текущий пароль</Label>
              <Input
                id="current-password"
                type="password"
                value={ownPasswordForm.current_password}
                onChange={(e) => onOwnPasswordFieldChange('current_password', e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-password">Новый пароль</Label>
              <Input
                id="new-password"
                type="password"
                minLength={6}
                value={ownPasswordForm.new_password}
                onChange={(e) => onOwnPasswordFieldChange('new_password', e.target.value)}
                required
              />
            </div>
          </div>
          <Button type="submit" disabled={changingOwnPassword}>
            {changingOwnPassword ? 'Сохранение...' : 'Сменить пароль'}
          </Button>
          {ownPasswordSuccess && <p className="text-sm text-green-600">{ownPasswordSuccess}</p>}
          {ownPasswordError && <p className="text-sm text-destructive">{ownPasswordError}</p>}
        </form>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-2 max-w-2xl">
        <h2 className="font-semibold">Режим видимости задач (заглушка)</h2>
        <p className="text-sm text-muted-foreground">
          Эту настройку переключает ваш руководитель в карточке сотрудника.
        </p>
        <label className="flex items-center justify-between rounded border px-3 py-2 text-sm">
          <span>Фильтр "только свои задачи"</span>
          <Switch
            checked={ownTasksVisibilityEnabled}
            onCheckedChange={() => {}}
            disabled
          />
        </label>
      </div>
    </>
  )
}
