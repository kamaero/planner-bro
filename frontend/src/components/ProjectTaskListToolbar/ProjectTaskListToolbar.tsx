import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatUserDisplayName } from '@/lib/userName'
import type { ProjectMember } from '@/types'

interface ProjectTaskListToolbarProps {
  taskSearch: string
  onTaskSearchChange: (value: string) => void
  taskStatusFilter: string
  onTaskStatusFilterChange: (value: string) => void
  taskAssigneeFilter: string
  onTaskAssigneeFilterChange: (value: string) => void
  members: ProjectMember[]
  selectedVisibleCount: number
  filteredTasksCount: number
  selectedTaskIdsCount: number
  onToggleSelectAllVisible: () => void
  taskSortBy: 'order' | 'status' | 'priority'
  onTaskSortByChange: (value: 'order' | 'status' | 'priority') => void
  taskSortDir: 'asc' | 'desc'
  onTaskSortDirChange: (value: 'asc' | 'desc') => void
  taskRowSize: 'compact' | 'normal' | 'comfortable'
  onTaskRowSizeChange: (value: 'compact' | 'normal' | 'comfortable') => void
  canManage: boolean
  canBulkEdit: boolean
  canDelete: boolean
  bulkBusy: boolean
  bulkAssignee: string
  onBulkAssigneeChange: (value: string) => void
  bulkPriority: string
  onBulkPriorityChange: (value: string) => void
  onBulkStatusUpdate: (status: string) => void
  onBulkDelete: () => void
  onBulkAssign: () => void
  onBulkPriority: () => void
}

export function ProjectTaskListToolbar({
  taskSearch,
  onTaskSearchChange,
  taskStatusFilter,
  onTaskStatusFilterChange,
  taskAssigneeFilter,
  onTaskAssigneeFilterChange,
  members,
  selectedVisibleCount,
  filteredTasksCount,
  selectedTaskIdsCount,
  onToggleSelectAllVisible,
  taskSortBy,
  onTaskSortByChange,
  taskSortDir,
  onTaskSortDirChange,
  taskRowSize,
  onTaskRowSizeChange,
  canManage,
  canBulkEdit,
  canDelete,
  bulkBusy,
  bulkAssignee,
  onBulkAssigneeChange,
  bulkPriority,
  onBulkPriorityChange,
  onBulkStatusUpdate,
  onBulkDelete,
  onBulkAssign,
  onBulkPriority,
}: ProjectTaskListToolbarProps) {
  return (
    <div className="sticky top-3 z-20 rounded-lg border bg-card/95 p-3 space-y-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <Input
          placeholder="Поиск по задачам..."
          value={taskSearch}
          onChange={(e) => onTaskSearchChange(e.target.value)}
        />
        <select
          value={taskStatusFilter}
          onChange={(e) => onTaskStatusFilterChange(e.target.value)}
          className="border rounded px-2 py-2 text-sm bg-background"
        >
          <option value="all">Все статусы</option>
          <option value="planning">Планирование</option>
          <option value="tz">ТЗ</option>
          <option value="todo">К выполнению</option>
          <option value="in_progress">В работе</option>
          <option value="testing">Тестирование</option>
          <option value="review">На проверке</option>
          <option value="done">Выполнено</option>
        </select>
        <select
          value={taskAssigneeFilter}
          onChange={(e) => onTaskAssigneeFilterChange(e.target.value)}
          className="border rounded px-2 py-2 text-sm bg-background"
        >
          <option value="all">Все исполнители</option>
          <option value="unassigned">Без исполнителя</option>
          {members.map((member) => (
            <option key={member.user.id} value={member.user.id}>
              {formatUserDisplayName(member.user)}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={onToggleSelectAllVisible}>
          {selectedVisibleCount === filteredTasksCount && filteredTasksCount > 0
            ? 'Снять выделение'
            : 'Выделить видимые'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Выбрано: {selectedTaskIdsCount} / Видимых: {filteredTasksCount}
        </span>
        <select
          value={taskSortBy}
          onChange={(e) => onTaskSortByChange(e.target.value as 'order' | 'status' | 'priority')}
          className="border rounded px-2 py-1 text-sm bg-background"
        >
          <option value="order">Сортировка: по порядку</option>
          <option value="status">Сортировка: по статусу</option>
          <option value="priority">Сортировка: по приоритету</option>
        </select>
        <select
          value={taskSortDir}
          onChange={(e) => onTaskSortDirChange(e.target.value as 'asc' | 'desc')}
          className="border rounded px-2 py-1 text-sm bg-background"
        >
          <option value="asc">По возрастанию</option>
          <option value="desc">По убыванию</option>
        </select>
        <select
          value={taskRowSize}
          onChange={(e) => onTaskRowSizeChange(e.target.value as 'compact' | 'normal' | 'comfortable')}
          className="border rounded px-2 py-1 text-sm bg-background"
        >
          <option value="compact">Плотность: компактно</option>
          <option value="normal">Плотность: обычная</option>
          <option value="comfortable">Плотность: свободно</option>
        </select>
        {canManage && canBulkEdit && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onBulkStatusUpdate('tz')}
              disabled={selectedTaskIdsCount === 0 || bulkBusy}
            >
              В ТЗ
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onBulkStatusUpdate('planning')}
              disabled={selectedTaskIdsCount === 0 || bulkBusy}
            >
              В планирование
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onBulkStatusUpdate('in_progress')}
              disabled={selectedTaskIdsCount === 0 || bulkBusy}
            >
              В работу
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onBulkStatusUpdate('review')}
              disabled={selectedTaskIdsCount === 0 || bulkBusy}
            >
              На проверку
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onBulkStatusUpdate('testing')}
              disabled={selectedTaskIdsCount === 0 || bulkBusy}
            >
              В тестирование
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onBulkStatusUpdate('done')}
              disabled={selectedTaskIdsCount === 0 || bulkBusy}
            >
              Завершить
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={onBulkDelete}
              disabled={selectedTaskIdsCount === 0 || bulkBusy || !canDelete}
            >
              Удалить выбранные
            </Button>
            <select
              value={bulkAssignee}
              onChange={(e) => onBulkAssigneeChange(e.target.value)}
              className="border rounded px-2 py-1 text-sm bg-background"
              disabled={selectedTaskIdsCount === 0 || bulkBusy}
            >
              <option value="keep">Исполнитель: без изменений</option>
              <option value="unassigned">Исполнитель: снять назначение</option>
              {members.map((member) => (
                <option key={member.user.id} value={member.user.id}>
                  Исполнитель: {formatUserDisplayName(member.user)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={onBulkAssign}
              disabled={selectedTaskIdsCount === 0 || bulkBusy || bulkAssignee === 'keep'}
            >
              Применить исполнителя
            </Button>
            <select
              value={bulkPriority}
              onChange={(e) => onBulkPriorityChange(e.target.value)}
              className="border rounded px-2 py-1 text-sm bg-background"
              disabled={selectedTaskIdsCount === 0 || bulkBusy}
            >
              <option value="keep">Приоритет: без изменений</option>
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
              <option value="critical">Критический</option>
              <option value="ski">Контроль СКИ (critical)</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={onBulkPriority}
              disabled={selectedTaskIdsCount === 0 || bulkBusy || bulkPriority === 'keep'}
            >
              Применить приоритет
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
