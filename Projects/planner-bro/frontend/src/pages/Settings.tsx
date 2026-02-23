import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNavigate } from 'react-router-dom'

export function Settings() {
  const { user, setUser, logout } = useAuthStore()
  const navigate = useNavigate()
  const [name, setName] = useState(user?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  const [invite, setInvite] = useState({ name: '', email: '', role: 'developer', password: '' })
  const [inviting, setInviting] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [inviteError, setInviteError] = useState('')

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const updated = await api.updateMe({ name })
    setUser(updated)
    setSaving(false)
    setSuccess(true)
    setTimeout(() => setSuccess(false), 2000)
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setInviteError('')
    setInviteSuccess('')
    try {
      await api.register({
        name: invite.name,
        email: invite.email,
        password: invite.password,
        role: invite.role,
      })
      setInviteSuccess(`Account created for ${invite.email}`)
      setInvite({ name: '', email: '', role: 'developer', password: '' })
    } catch (err: any) {
      setInviteError(err?.response?.data?.detail ?? 'Failed to create account')
    } finally {
      setInviting(false)
    }
  }

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Profile */}
      <div className="rounded-xl border bg-card p-6 space-y-6">
        <div>
          <h2 className="font-semibold mb-4">Profile</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={user?.email ?? ''} disabled className="opacity-60" />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Input value={user?.role ?? ''} disabled className="opacity-60" />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
            {success && <p className="text-sm text-green-600">Saved!</p>}
          </form>
        </div>

        <div className="border-t pt-4">
          <Button variant="destructive" onClick={handleLogout}>
            Sign Out
          </Button>
        </div>
      </div>

      {/* Invite / create team member */}
      <div className="rounded-xl border bg-card p-6">
        <h2 className="font-semibold mb-1">Add Team Member</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Create an account for a teammate. Share the email and password with them — they can change it later.
        </p>
        <form onSubmit={handleInvite} className="space-y-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              placeholder="Ivan Petrov"
              value={invite.name}
              onChange={(e) => setInvite((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              type="email"
              placeholder="ivan@example.com"
              value={invite.email}
              onChange={(e) => setInvite((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <select
              value={invite.role}
              onChange={(e) => setInvite((f) => ({ ...f, role: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm bg-background"
            >
              <option value="developer">Developer</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Temporary Password</Label>
            <Input
              type="text"
              placeholder="Share this with them"
              value={invite.password}
              onChange={(e) => setInvite((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={6}
            />
          </div>
          <Button type="submit" disabled={inviting}>
            {inviting ? 'Creating...' : 'Create Account'}
          </Button>
          {inviteSuccess && <p className="text-sm text-green-600">{inviteSuccess}</p>}
          {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
        </form>
      </div>
    </div>
  )
}
