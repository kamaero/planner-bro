import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { User } from '@/types'

export function useUsers() {
  return useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.listUsers(),
  })
}
