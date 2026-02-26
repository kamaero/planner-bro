import asyncio

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.project import Project, ProjectMember
from app.models.task import Task
from app.models.user import User
from app.services.notification_service import send_management_gap_report
from app.tasks.celery_app import celery_app


@celery_app.task(name="app.tasks.management_audit_checker.check_management_gaps")
def check_management_gaps():
    asyncio.run(_async_check_management_gaps())


async def _async_check_management_gaps():
    if not settings.MANAGEMENT_AUDIT_ENABLED:
        return

    async with AsyncSessionLocal() as db:
        active_managers = (
            await db.execute(
                select(User.id).where(
                    User.is_active == True,  # noqa: E712
                    User.role.in_(("admin", "manager")),
                )
            )
        ).scalars().all()
        manager_ids = set(active_managers)

        projects = (await db.execute(select(Project.id, Project.name))).all()
        missing_project_managers: list[tuple[str, str]] = []
        for project_id, project_name in projects:
            member_ids = (
                await db.execute(
                    select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
                )
            ).scalars().all()
            if not any(uid in manager_ids for uid in member_ids):
                missing_project_managers.append((project_id, project_name))

        task_rows = (
            await db.execute(
                select(Task.id, Task.title, Task.project_id, Task.assigned_to_id).where(Task.status != "done")
            )
        ).all()
        missing_task_managers: list[tuple[str, str, str]] = []
        for task_id, task_title, project_id, assigned_to_id in task_rows:
            if assigned_to_id is None or assigned_to_id not in manager_ids:
                missing_task_managers.append((task_id, task_title, project_id))

        await send_management_gap_report(
            missing_project_managers=missing_project_managers,
            missing_task_managers=missing_task_managers,
        )
