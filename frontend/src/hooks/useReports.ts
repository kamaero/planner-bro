import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { StatusSnapshotReport } from '@/types'

export function useStatusSnapshotReport(params?: { from?: string; to?: string; department_id?: string }) {
  return useQuery<StatusSnapshotReport>({
    queryKey: ['status-snapshot-report', params?.from ?? '', params?.to ?? '', params?.department_id ?? ''],
    queryFn: () => api.getStatusSnapshotReport(params),
    staleTime: 60_000,
  })
}
