import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { UserPermissions } from '@/types'

const FALLBACK: UserPermissions = {
  role: 'developer',
  can_delete: false,
  can_import: false,
  can_bulk_edit: false,
  can_manage_team: false,
  visibility_scope: 'department_scope',
  actions: {
    create_project: true,
    delete_project: false,
    import_tasks: false,
    bulk_edit_tasks: false,
    manage_team: false,
    manage_departments: false,
    access_vault: true,
    upload_vault_files: true,
    delete_vault_files: false,
    manage_report_settings: false,
  },
}

export function useMyPermissions() {
  const { data, isLoading } = useQuery<UserPermissions>({
    queryKey: ['my-permissions'],
    queryFn: () => api.getMyPermissions(),
    staleTime: 5 * 60 * 1000, // cache for 5 minutes
    retry: 1,
  })
  return { permissions: data ?? FALLBACK, isLoading }
}
