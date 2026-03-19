import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatUserDisplayName } from '@/lib/userName'
import type { Department, User } from '@/types'
import { Link } from 'react-router-dom'
import type { FormEvent } from 'react'

type InviteRole = 'developer' | 'manager' | 'admin'
type InviteVisibility = 'own_tasks_only' | 'department_scope' | 'full_scope'

type InviteDraft = {
  first_name: string
  middle_name: string
  last_name: string
  email: string
  work_email: string
  role: InviteRole
  visibility_scope: InviteVisibility
  own_tasks_visibility_enabled: boolean
  password: string
  position_title: string
  manager_id: string
  department_id: string
}

type TeamUserInviteSectionProps = {
  users: User[]
  departments: Department[]
  invite: InviteDraft
  inviting: boolean
  inviteSuccess: string
  inviteError: string
  canCreateSubordinates: boolean
  currentUserRole?: User['role']
  onInviteSubmit: (e: FormEvent) => void
  onInviteFieldChange: <K extends keyof InviteDraft>(field: K, value: InviteDraft[K]) => void
  onInviteRoleChange: (role: InviteRole) => void
}

export function TeamUserInviteSection({
  users,
  departments,
  invite,
  inviting,
  inviteSuccess,
  inviteError,
  canCreateSubordinates,
  currentUserRole,
  onInviteSubmit,
  onInviteFieldChange,
  onInviteRoleChange,
}: TeamUserInviteSectionProps) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold mb-1">Добавить сотрудника</h2>
          <p className="text-sm text-muted-foreground mb-4">Создает новую учетную запись подчиненного.</p>
        </div>
        <Link
          to="/help#assignment-policy"
          className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          Кто кого может назначать
        </Link>
      </div>
      <div className="mb-4 grid gap-2 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground md:grid-cols-3">
        <p><span className="font-medium text-foreground">Developer</span> обычно работает в личном контуре.</p>
        <p><span className="font-medium text-foreground">Manager</span> получает departmental-видимость и управление подчинёнными.</p>
        <p><span className="font-medium text-foreground">Admin</span> видит всю систему и назначает без ограничений.</p>
      </div>
      <form onSubmit={onInviteSubmit} className="space-y-4 max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Имя</Label>
            <Input
              placeholder="Иван"
              value={invite.first_name}
              onChange={(e) => onInviteFieldChange('first_name', e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Фамилия</Label>
            <Input
              placeholder="Петров"
              value={invite.last_name}
              onChange={(e) => onInviteFieldChange('last_name', e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Отчество</Label>
            <Input
              placeholder="Иванович"
              value={invite.middle_name}
              onChange={(e) => onInviteFieldChange('middle_name', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              type="email"
              placeholder="ivan@example.com"
              value={invite.email}
              onChange={(e) => onInviteFieldChange('email', e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Корпоративный email</Label>
            <Input
              type="email"
              placeholder="ivan@company.com"
              value={invite.work_email}
              onChange={(e) => onInviteFieldChange('work_email', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Должность</Label>
            <Input
              placeholder="Начальник отдела / ГИП / ..."
              value={invite.position_title}
              onChange={(e) => onInviteFieldChange('position_title', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Руководитель</Label>
            <select
              value={invite.manager_id}
              onChange={(e) => onInviteFieldChange('manager_id', e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              <option value="">Не назначен</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{formatUserDisplayName(u)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Отдел</Label>
            <select
              value={invite.department_id}
              onChange={(e) => onInviteFieldChange('department_id', e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              <option value="">Без отдела</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Роль</Label>
            <select
              value={invite.role}
              onChange={(e) => onInviteRoleChange(e.target.value as InviteRole)}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              <option value="developer">Developer</option>
              <option value="manager">Manager</option>
              {currentUserRole === 'admin' && <option value="admin">Admin</option>}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Видимость</Label>
            <select
              value={invite.visibility_scope}
              onChange={(e) => onInviteFieldChange('visibility_scope', e.target.value as InviteVisibility)}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              <option value="own_tasks_only">own_tasks_only</option>
              <option value="department_scope">department_scope</option>
              {currentUserRole === 'admin' && <option value="full_scope">full_scope</option>}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Фильтр "только свои задачи"</Label>
            <label className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>{invite.own_tasks_visibility_enabled ? 'Включен' : 'Выключен'}</span>
              <Switch
                checked={invite.own_tasks_visibility_enabled}
                onCheckedChange={(checked) => onInviteFieldChange('own_tasks_visibility_enabled', checked)}
              />
            </label>
          </div>
          <div className="space-y-1">
            <Label>Временный пароль</Label>
            <Input
              type="text"
              placeholder="Не короче 6 символов"
              value={invite.password}
              onChange={(e) => onInviteFieldChange('password', e.target.value)}
              required
              minLength={6}
            />
          </div>
        </div>
        <Button type="submit" disabled={inviting || !canCreateSubordinates}>
          {inviting ? 'Создание...' : 'Создать аккаунт'}
        </Button>
        {!canCreateSubordinates && (
          <p className="text-xs text-muted-foreground">Создавать подчиненных могут только менеджеры/администраторы.</p>
        )}
        {inviteSuccess && <p className="text-sm text-green-600">{inviteSuccess}</p>}
        {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
      </form>
    </div>
  )
}
