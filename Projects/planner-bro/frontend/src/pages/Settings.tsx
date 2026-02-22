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

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

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
    </div>
  )
}
