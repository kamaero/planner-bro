import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { VaultFile, VaultDownloadToken } from '@/types'

export function useVaultFiles(folder?: string) {
  return useQuery<VaultFile[]>({
    queryKey: ['vault', folder ?? '__all__'],
    queryFn: () => api.listVaultFiles(folder),
  })
}

export function useUploadVaultFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, folder, description }: { file: File; folder?: string; description?: string }) =>
      api.uploadVaultFile(file, folder, description),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vault'] }),
  })
}

export function useDeleteVaultFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fileId: string) => api.deleteVaultFile(fileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vault'] }),
  })
}

export function useVaultDownloadToken() {
  return useMutation<VaultDownloadToken, Error, string>({
    mutationFn: (fileId: string) => api.getVaultDownloadToken(fileId),
  })
}
