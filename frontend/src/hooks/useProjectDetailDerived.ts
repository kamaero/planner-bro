import { useMemo } from 'react'
import { buildTaskHierarchy } from '@/lib/taskOrdering'
import type { Project, ProjectFile, ProjectMember, Task, User } from '@/types'

type UseProjectDetailDerivedParams = {
  project?: Project
  tasks: Task[]
  members: ProjectMember[]
  users: User[]
  files: ProjectFile[]
  currentUser?: User | null
}

export function useProjectDetailDerived({
  project,
  tasks,
  members,
  users,
  files,
  currentUser,
}: UseProjectDetailDerivedParams) {
  const memberRole = members.find((member) => member.user.id === currentUser?.id)?.role

  const canManage = currentUser?.role === 'admin' || memberRole === 'owner' || memberRole === 'manager'
  const canRenameProject =
    canManage ||
    currentUser?.role === 'manager' ||
    !!currentUser?.can_manage_team ||
    currentUser?.visibility_scope === 'department_scope'
  const canTransferOwnership = currentUser?.role === 'admin' || memberRole === 'owner'
  const canDelete = currentUser?.role === 'admin' || !!currentUser?.can_delete
  const canImport = currentUser?.role === 'admin' || !!currentUser?.can_import
  const canBulkEdit = currentUser?.role === 'admin' || !!currentUser?.can_bulk_edit

  const canAssignAcrossOrg = useMemo(() => {
    const position = (currentUser?.position_title ?? '').toLowerCase()
    const isGlobalPosition =
      position.includes('гип') ||
      position.includes('главный инженер проектов') ||
      position.includes('зам') ||
      position.includes('заместитель')
    return (
      currentUser?.role === 'admin' ||
      currentUser?.role === 'manager' ||
      !!currentUser?.can_manage_team ||
      isGlobalPosition
    )
  }, [currentUser?.can_manage_team, currentUser?.position_title, currentUser?.role])

  const projectAssigneeOptions = useMemo(() => {
    if (canAssignAcrossOrg || members.length === 0) return users
    const uniqueUsers = new Map<string, User>()
    for (const member of members) uniqueUsers.set(member.user.id, member.user)
    return Array.from(uniqueUsers.values())
  }, [canAssignAcrossOrg, members, users])

  const projectProgress = useMemo(() => {
    if (!tasks.length) return 0
    const sum = tasks.reduce((acc, task) => acc + (task.progress_percent ?? 0), 0)
    return Math.round(sum / tasks.length)
  }, [tasks])

  const progressStats = useMemo(() => {
    let completedCount = 0
    let zeroProgressCount = 0
    for (const task of tasks) {
      const progress = task.progress_percent ?? 0
      if (task.status === 'done' || progress >= 100) completedCount += 1
      if (progress === 0) zeroProgressCount += 1
    }
    return { completedCount, zeroProgressCount, totalCount: tasks.length }
  }, [tasks])

  const taskHierarchyOptions = useMemo(() => buildTaskHierarchy(tasks), [tasks])

  const launchBasisFile = useMemo(() => {
    const fileId = project?.launch_basis_file_id
    if (!fileId) return null
    return files.find((file) => file.id === fileId) ?? null
  }, [files, project?.launch_basis_file_id])

  return {
    canManage,
    canRenameProject,
    canTransferOwnership,
    canDelete,
    canImport,
    canBulkEdit,
    projectAssigneeOptions,
    projectProgress,
    progressStats,
    taskHierarchyOptions,
    launchBasisFile,
  }
}
