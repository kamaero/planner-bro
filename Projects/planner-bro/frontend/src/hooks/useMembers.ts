import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { ProjectMember, User } from '@/types'

export function useMembers(projectId: string) {
  return useQuery<ProjectMember[]>({
    queryKey: ['members', projectId],
    queryFn: () => api.listMembers(projectId),
    enabled: !!projectId,
  })
}

export function useAddMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, userId, role }: { projectId: string; userId: string; role: string }) =>
      api.addMember(projectId, userId, role),
    onSuccess: (_, { projectId }) => qc.invalidateQueries({ queryKey: ['members', projectId] }),
  })
}

export function useRemoveMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) =>
      api.removeMember(projectId, userId),
    onSuccess: (_, { projectId }) => qc.invalidateQueries({ queryKey: ['members', projectId] }),
  })
}

export function useSearchUsers(query: string) {
  return useQuery<User[]>({
    queryKey: ['users', 'search', query],
    queryFn: () => api.searchUsers(query),
    enabled: query.length >= 2,
  })
}
