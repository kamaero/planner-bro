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
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalar_one_or_none()

    result = await db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .options(selectinload(Task.assignee), selectinload(Task.predecessor_links))
    )
    tasks = result.scalars().all()

    basis_date = None
    if project and project.start_date:
        basis_date = project.start_date
    else:
        for t in tasks:
            if t.start_date and (basis_date is None or t.start_date < basis_date):
                basis_date = t.start_date
    if basis_date is None:
        basis_date = date.today()

    gantt_tasks = []
    if project and (project.launch_basis_text or project.launch_basis_file_id):
        gantt_tasks.append(
            GanttTask(
                id=f"launch_basis:{project_id}",
                name="Основание запуска",
                start=basis_date.isoformat(),
                end=basis_date.isoformat(),
                progress=0.0,
                dependencies=[],
                type="milestone",
                project=project_id,
                assignee=None,
                color="#111827",
                priority=None,
                status=None,
            )
        )
    for t in tasks:
        start = t.start_date or date.today()
        end = t.end_date or start
        # calculate progress based on status
        progress_map = {"todo": 0.0, "in_progress": 0.3, "review": 0.7, "done": 1.0}
        progress = progress_map.get(t.status, 0.0)

        dependency_ids = [link.predecessor_task_id for link in t.predecessor_links]
        if t.parent_task_id and t.parent_task_id not in dependency_ids:
            dependency_ids.append(t.parent_task_id)

        gantt_tasks.append(
            GanttTask(
                id=t.id,
                name=t.title,
                start=start.isoformat(),
                end=end.isoformat(),
                progress=progress,
                dependencies=dependency_ids,
                type="task",
                project=project_id,
                assignee=t.assignee.name if t.assignee else None,
                priority=t.priority,
                status=t.status,
            )
        )

    return GanttData(tasks=gantt_tasks)
