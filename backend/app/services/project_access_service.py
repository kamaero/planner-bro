import uuid
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.ai import AITaskDraft
from app.models.department import Department
from app.models.project import Project, ProjectDepartment, ProjectFile, ProjectMember
from app.models.user import User
from app.models.vault import VaultFile
from app.services.access_scope import can_access_project, get_task_assignment_scope_user_ids


def project_vault_key(secret_key: str, vault_encryption_key: str) -> str:
    if vault_encryption_key:
        return vault_encryption_key
    import hashlib

    return hashlib.sha256(secret_key.encode()).hexdigest()


async def require_project_access(
    project_id: str, user: User, db: AsyncSession, require_manager: bool = False
) -> Project:
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .options(selectinload(Project.owner), selectinload(Project.departments))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not await can_access_project(db, user, project_id):
        raise HTTPException(status_code=403, detail="Access denied")

    if require_manager and user.role != "admin":
        member_result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user.id,
            )
        )
        member = member_result.scalar_one_or_none()
        if not member or member.role not in ("owner", "manager"):
            raise HTTPException(status_code=403, detail="Manager access required")

    return project


async def validate_department_ids(db: AsyncSession, department_ids: list[str]) -> list[str]:
    normalized = sorted({dep_id for dep_id in department_ids if dep_id})
    if not normalized:
        return []
    existing = (
        await db.execute(select(Department.id).where(Department.id.in_(normalized)))
    ).scalars().all()
    if len(existing) != len(normalized):
        raise HTTPException(status_code=400, detail="One or more departments do not exist")
    return normalized


async def sync_project_departments(db: AsyncSession, project_id: str, department_ids: list[str]) -> None:
    await db.execute(delete(ProjectDepartment).where(ProjectDepartment.project_id == project_id))
    for dep_id in department_ids:
        db.add(ProjectDepartment(project_id=project_id, department_id=dep_id))


async def get_member(project_id: str, user_id: str, db: AsyncSession) -> ProjectMember | None:
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def get_project_file_or_404(
    db: AsyncSession,
    *,
    project_id: str,
    file_id: str,
) -> ProjectFile:
    file_record = (
        await db.execute(
            select(ProjectFile).where(
                ProjectFile.id == file_id,
                ProjectFile.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")
    return file_record


async def require_assignment_scope_user(
    db: AsyncSession,
    actor: User,
    target_user_id: str,
) -> None:
    allowed_user_ids = await get_task_assignment_scope_user_ids(db, actor)
    if target_user_id not in allowed_user_ids:
        raise HTTPException(status_code=403, detail="No permission to assign this user")


async def maybe_archive_processed_file(
    project_id: str,
    project_file_id: str,
    actor_id: str,
    db: AsyncSession,
) -> None:
    from app.services.project_file_storage import read_project_file_bytes
    from app.services.vault_crypto import encrypt_file

    pending_count = (
        await db.execute(
            select(func.count())
            .select_from(AITaskDraft)
            .where(
                AITaskDraft.project_id == project_id,
                AITaskDraft.project_file_id == project_file_id,
                AITaskDraft.status == "pending",
            )
        )
    ).scalar_one()
    if pending_count:
        return

    project_file = (
        await db.execute(
            select(ProjectFile).where(
                ProjectFile.id == project_file_id,
                ProjectFile.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if not project_file:
        return

    try:
        plaintext = read_project_file_bytes(project_file)
    except FileNotFoundError:
        return

    if plaintext:
        archive_description = f"Обработанный файл проекта {project_id} (source_file_id={project_file_id})"
        existing_archive = (
            await db.execute(
                select(VaultFile.id).where(
                    VaultFile.folder == "Processed",
                    VaultFile.name == project_file.filename,
                    VaultFile.description == archive_description,
                )
            )
        ).scalar_one_or_none()
        if existing_archive:
            return

        vault_id = str(uuid.uuid4())
        ciphertext, nonce = encrypt_file(
            project_vault_key(settings.SECRET_KEY, settings.VAULT_ENCRYPTION_KEY),
            vault_id,
            plaintext,
        )
        vault_dir = Path(settings.VAULT_FILES_DIR)
        vault_dir.mkdir(parents=True, exist_ok=True)
        vault_storage_path = vault_dir / vault_id
        vault_storage_path.write_bytes(ciphertext)
        db.add(
            VaultFile(
                id=vault_id,
                name=project_file.filename,
                description=archive_description,
                content_type=project_file.content_type,
                size=len(plaintext),
                encrypted_size=len(ciphertext),
                storage_path=str(vault_storage_path),
                nonce=nonce,
                folder="Processed",
                uploaded_by_id=actor_id,
            )
        )
