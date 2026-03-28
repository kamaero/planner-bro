import type { Task, ProjectMember, Project } from '@/types'
import type { ExternalDep } from '@/hooks/useProjects'
import { formatUserDisplayName } from '@/lib/userName'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TaskTable } from '@/components/TaskTable/TaskTable'

interface Props {
  tasks: Task[]
  filteredTasks: Task[]
  members: ProjectMember[]
  allProjects: Project[]
  projectId: string
  // filter state
  taskSearch: string
  setTaskSearch: (v: string) => void
  taskStatusFilter: string
  setTaskStatusFilter: (v: string) => void
  taskAssigneeFilter: string
  setTaskAssigneeFilter: (v: string) => void
  hideDone: boolean
  setHideDone: (v: (prev: boolean) => boolean) => void
  taskSortBy: 'order' | 'status' | 'priority'
  setTaskSortBy: (v: 'order' | 'status' | 'priority') => void
  taskSortDir: 'asc' | 'desc'
  setTaskSortDir: (v: 'asc' | 'desc') => void
  taskRowSize: 'compact' | 'normal' | 'comfortable'
  setTaskRowSize: (v: 'compact' | 'normal' | 'comfortable') => void
  // selection
  selectedTaskIds: string[]
  selectedVisibleCount: number
  onToggleSelectAllVisible: () => void
  // bulk edit
  canManage: boolean
  canBulkEdit: boolean
  canDelete: boolean
  bulkBusy: boolean
  bulkAssignee: string
  setBulkAssignee: (v: string) => void
  bulkPriority: string
  setBulkPriority: (v: string) => void
  bulkShiftDays: string
  setBulkShiftDays: (v: string) => void
  bulkShiftReason: string
  setBulkShiftReason: (v: string) => void
  bulkMoveProjectId: string
  setBulkMoveProjectId: (v: string) => void
  onBulkStatusUpdate: (status: string) => void
  onBulkAssign: () => void
  onBulkPriority: () => void
  onBulkDelete: () => void
  onBulkShiftDeadline: () => void
  onBulkMoveToProject: () => void
  // task table
  hasChildrenIds: Set<string>
  collapsedTaskIds: Set<string>
  onToggleCollapse: (taskId: string) => void
  onTaskClick: (task: Task) => void
  onReorder?: (fromIndex: number, toIndex: number) => void
  onStatusChange: (taskId: string, status: string) => void
  shiftsMap: Record<string, number>
  externalDepsMap: Record<string, ExternalDep[]>
  isFetching: boolean
}

export function ProjectTaskListView({
  tasks,
  filteredTasks,
  members,
  allProjects,
  projectId,
  taskSearch,
  setTaskSearch,
  taskStatusFilter,
  setTaskStatusFilter,
  taskAssigneeFilter,
  setTaskAssigneeFilter,
  hideDone,
  setHideDone,
  taskSortBy,
  setTaskSortBy,
  taskSortDir,
  setTaskSortDir,
  taskRowSize,
  setTaskRowSize,
  selectedTaskIds,
  selectedVisibleCount,
  onToggleSelectAllVisible,
  canManage,
  canBulkEdit,
  canDelete,
  bulkBusy,
  bulkAssignee,
  setBulkAssignee,
  bulkPriority,
  setBulkPriority,
  bulkShiftDays,
  setBulkShiftDays,
  bulkShiftReason,
  setBulkShiftReason,
  bulkMoveProjectId,
  setBulkMoveProjectId,
  onBulkStatusUpdate,
  onBulkAssign,
  onBulkPriority,
  onBulkDelete,
  onBulkShiftDeadline,
  onBulkMoveToProject,
  hasChildrenIds,
  collapsedTaskIds,
  onToggleCollapse,
  onTaskClick,
  onReorder,
  onStatusChange,
  shiftsMap,
  externalDepsMap,
  isFetching,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input
            placeholder="Поиск по задачам..."
            value={taskSearch}
            onChange={(e) => setTaskSearch(e.target.value)}
          />
          <select
            value={taskStatusFilter}
            onChange={(e) => setTaskStatusFilter(e.target.value)}
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
            onChange={(e) => setTaskAssigneeFilter(e.target.value)}
            className="border rounded px-2 py-2 text-sm bg-background"
          >
            <option value="all">Все исполнители</option>
            <option value="unassigned">Без исполнителя</option>
            {members.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {formatUserDisplayName(m.user)}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={onToggleSelectAllVisible}>
            {selectedVisibleCount === filteredTasks.length && filteredTasks.length > 0
              ? 'Снять выделение'
              : 'Выделить видимые'}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Выбрано: {selectedTaskIds.length} / Видимых: {filteredTasks.length}
          </span>
          <Button
            variant={hideDone ? 'default' : 'outline'}
            size="sm"
            onClick={() => setHideDone((v) => !v)}
          >
            {hideDone
              ? `Показать выполненные (${tasks.filter((t) => t.status === 'done').length})`
              : 'Скрыть выполненные'}
          </Button>
          <select
            value={taskSortBy}
            onChange={(e) => setTaskSortBy(e.target.value as 'order' | 'status' | 'priority')}
            className="border rounded px-2 py-1 text-sm bg-background"
          >
            <option value="order">Сортировка: по порядку</option>
            <option value="status">Сортировка: по статусу</option>
            <option value="priority">Сортировка: по приоритету</option>
          </select>
          <select
            value={taskSortDir}
            onChange={(e) => setTaskSortDir(e.target.value as 'asc' | 'desc')}
            className="border rounded px-2 py-1 text-sm bg-background"
          >
            <option value="asc">По возрастанию</option>
            <option value="desc">По убыванию</option>
          </select>
          <select
            value={taskRowSize}
            onChange={(e) => setTaskRowSize(e.target.value as 'compact' | 'normal' | 'comfortable')}
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
                disabled={selectedTaskIds.length === 0 || bulkBusy}
              >
                В ТЗ
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBulkStatusUpdate('planning')}
                disabled={selectedTaskIds.length === 0 || bulkBusy}
              >
                В планирование
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBulkStatusUpdate('in_progress')}
                disabled={selectedTaskIds.length === 0 || bulkBusy}
              >
                В работу
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBulkStatusUpdate('review')}
                disabled={selectedTaskIds.length === 0 || bulkBusy}
              >
                На проверку
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBulkStatusUpdate('testing')}
                disabled={selectedTaskIds.length === 0 || bulkBusy}
              >
                В тестирование
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBulkStatusUpdate('done')}
                disabled={selectedTaskIds.length === 0 || bulkBusy}
              >
                Завершить
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={onBulkDelete}
                disabled={selectedTaskIds.length === 0 || bulkBusy || !canDelete}
              >
                Удалить выбранные
              </Button>
              <select
                value={bulkAssignee}
                onChange={(e) => setBulkAssignee(e.target.value)}
                className="border rounded px-2 py-1 text-sm bg-background"
                disabled={selectedTaskIds.length === 0 || bulkBusy}
              >
                <option value="keep">Исполнитель: без изменений</option>
                <option value="unassigned">Исполнитель: снять назначение</option>
                {members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    Исполнитель: {formatUserDisplayName(m.user)}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={onBulkAssign}
                disabled={selectedTaskIds.length === 0 || bulkBusy || bulkAssignee === 'keep'}
              >
                Применить исполнителя
              </Button>
              <select
                value={bulkPriority}
                onChange={(e) => setBulkPriority(e.target.value)}
                className="border rounded px-2 py-1 text-sm bg-background"
                disabled={selectedTaskIds.length === 0 || bulkBusy}
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
                disabled={selectedTaskIds.length === 0 || bulkBusy || bulkPriority === 'keep'}
              >
                Применить приоритет
              </Button>
              {/* Deadline shift */}
              <input
                type="number"
                placeholder="Дней (±)"
                value={bulkShiftDays}
                onChange={(e) => setBulkShiftDays(e.target.value)}
                disabled={selectedTaskIds.length === 0 || bulkBusy}
                className="border rounded px-2 py-1 text-sm bg-background w-24"
              />
              <input
                type="text"
                placeholder="Причина сдвига"
                value={bulkShiftReason}
                onChange={(e) => setBulkShiftReason(e.target.value)}
                disabled={selectedTaskIds.length === 0 || bulkBusy}
                className="border rounded px-2 py-1 text-sm bg-background w-40"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={onBulkShiftDeadline}
                disabled={selectedTaskIds.length === 0 || bulkBusy || !bulkShiftDays || !bulkShiftReason.trim()}
              >
                Сдвинуть дедлайн
              </Button>
              {/* Move to project */}
              <select
                value={bulkMoveProjectId}
                onChange={(e) => setBulkMoveProjectId(e.target.value)}
                className="border rounded px-2 py-1 text-sm bg-background"
                disabled={selectedTaskIds.length === 0 || bulkBusy}
              >
                <option value="">Перенести в проект...</option>
                {allProjects
                  .filter((p) => p.id !== projectId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={onBulkMoveToProject}
                disabled={selectedTaskIds.length === 0 || bulkBusy || !bulkMoveProjectId}
              >
                Перенести
              </Button>
            </>
          )}
        </div>
      </div>

      <TaskTable
        tasks={filteredTasks}
        allTasks={tasks}
        onTaskClick={onTaskClick}
        hasChildrenIds={hasChildrenIds}
        collapsedTaskIds={collapsedTaskIds}
        onToggleCollapse={onToggleCollapse}
        onReorder={onReorder}
        onStatusChange={onStatusChange}
        shiftsMap={shiftsMap}
        rowSize={taskRowSize}
        externalDepsMap={externalDepsMap}
        isFetching={isFetching}
      />
    </div>
  )
}
