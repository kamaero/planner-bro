import { useState, useEffect, useRef } from 'react'
import {
  useMembers,
  useAddMember,
  useRemoveMember,
  useUpdateMemberRole,
  useSearchUsers,
} from '@/hooks/useMembers'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { UserPlus, Trash2 } from 'lucide-react'
import type { User } from '@/types'

interface MembersPanelProps {
  projectId: string
}

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  manager: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  member: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
}

export function MembersPanel({ projectId }: MembersPanelProps) {
  const { user: currentUser } = useAuthStore()
  const { data: members = [] } = useMembers(projectId)
  const addMember = useAddMember()
  const removeMember = useRemoveMember()
  const updateMemberRole = useUpdateMemberRole()

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [role, setRole] = useState('member')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const { data: searchResults = [] } = useSearchUsers(debouncedQuery)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const currentMember = members.find((m) => m.user.id === currentUser?.id)
  const canManage =
    currentUser?.role === 'admin' || currentMember?.role === 'owner' || currentMember?.role === 'manager'
  const canAssignManager = currentUser?.role === 'admin' || currentMember?.role === 'owner'

  const handleSelectUser = (user: User) => {
    setSelectedUser(user)
    setQuery(user.email)
    setDropdownOpen(false)
  }

  const handleAdd = async () => {
    const user = selectedUser ?? (searchResults.length === 1 ? searchResults[0] : null)
    if (!user) return
    if (!canAssignManager && role === 'manager') return
    await addMember.mutateAsync({ projectId, userId: user.id, role })
    setSelectedUser(null)
    setQuery('')
    setDebouncedQuery('')
    setRole('member')
    setDropdownOpen(false)
  }

  const handleRemove = async (userId: string) => {
    if (window.confirm('Remove this member?')) {
      await removeMember.mutateAsync({ projectId, userId })
    }
  }

  const handleRoleChange = async (userId: string, nextRole: string) => {
    if (!canAssignManager && nextRole === 'manager') return
    await updateMemberRole.mutateAsync({ projectId, userId, role: nextRole })
  }

  return (
    <div className="space-y-4">
      {/* Member list */}
      <div className="space-y-2">
        {members.map((m) => (
          <div
            key={m.user.id}
            className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                {m.user.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium">{m.user.name}</p>
                <p className="text-xs text-muted-foreground">{m.user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canManage && m.role !== 'owner' && m.user.id !== currentUser?.id ? (
                <select
                  value={m.role}
                  onChange={(e) => handleRoleChange(m.user.id, e.target.value)}
                  className={`text-xs px-2 py-1 rounded-full font-medium border bg-background ${ROLE_COLORS[m.role]}`}
                  disabled={updateMemberRole.isPending}
                >
                  <option value="member">member</option>
                  <option value="manager" disabled={!canAssignManager}>
                    manager
                  </option>
                </select>
              ) : (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[m.role]}`}>
                  {m.role}
                </span>
              )}
              {canManage && m.role !== 'owner' && m.user.id !== currentUser?.id && (
                <button
                  onClick={() => handleRemove(m.user.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Remove member"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add member form */}
      {canManage && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-medium">Add member</p>
          <div className="flex gap-2">
            <div className="relative flex-1" ref={dropdownRef}>
              <Input
                placeholder="Search by email or name..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedUser(null)
                  setDropdownOpen(true)
                }}
                onFocus={() => query.length >= 2 && setDropdownOpen(true)}
              />
              {dropdownOpen && searchResults.length > 0 && (
                <div className="absolute z-10 top-full mt-1 w-full rounded-md border bg-card shadow-md">
                  {searchResults.map((u) => (
                    <button
                      key={u.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                      onMouseDown={() => handleSelectUser(u)}
                    >
                      <span className="font-medium">{u.name}</span>
                      <span className="text-muted-foreground ml-2">{u.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="border rounded px-2 py-2 text-sm bg-background"
            >
              <option value="member">Member</option>
              <option value="manager" disabled={!canAssignManager}>
                Manager
              </option>
            </select>
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={(!selectedUser && searchResults.length === 0) || addMember.isPending}
            >
              <UserPlus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
