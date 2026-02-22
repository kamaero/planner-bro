from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from datetime import date
from app.models.project import Project, ProjectMember
from app.models.task import Task
from app.schemas.project import GanttTask, GanttData


async def get_projects_for_user(db: AsyncSession, user_id: str) -> list[Project]:
    # Projects where user is a member
    result = await db.execute(
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user_id)
        .options(selectinload(Project.owner))
    )
    return result.scalars().all()


async def get_gantt_data(db: AsyncSession, project_id: str) -> GanttData:
    result = await db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .options(selectinload(Task.assignee))
    )
    tasks = result.scalars().all()

    gantt_tasks = []
    for t in tasks:
        start = t.start_date or date.today()
        end = t.end_date or start
        # calculate progress based on status
        progress_map = {"todo": 0.0, "in_progress": 0.3, "review": 0.7, "done": 1.0}
        progress = progress_map.get(t.status, 0.0)

        gantt_tasks.append(
            GanttTask(
                id=t.id,
                name=t.title,
                start=start.isoformat(),
                end=end.isoformat(),
                progress=progress,
                dependencies=[t.parent_task_id] if t.parent_task_id else [],
                type="task",
                project=project_id,
                assignee=t.assignee.name if t.assignee else None,
                priority=t.priority,
                status=t.status,
            )
        )

    return GanttData(tasks=gantt_tasks)
