"""Central permission service — single source of truth for all access checks.

Replaces the scattered require_*/can_* helpers spread across project_rules_service,
task_access_service, vault.py, and users.py.

Every denied access is logged to SystemActivityLog (source="access_control") so
admins can audit who was blocked, on what, and why.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.system_activity_service import log_system_activity

logger = logging.getLogger(__name__)

# ── Boolean capability checks ──────────────────────────────────────────────────

def can_delete(user: User) -> bool:
    return user.role == "admin" or bool(user.can_delete)


def can_import(user: User) -> bool:
    return user.role == "admin" or bool(user.can_import)


def can_bulk_edit(user: User) -> bool:
    return user.role == "admin" or bool(user.can_bulk_edit)


def can_manage_team(user: User) -> bool:
    return user.role == "admin" or bool(user.can_manage_team)


def can_manage_projects(user: User) -> bool:
    """Can create or administer projects (admin or manager role)."""
    return user.role in ("admin", "manager")


def can_delete_vault_files(user: User) -> bool:
    return can_delete(user)


def capabilities(user: User) -> dict[str, Any]:
    """Return the full capabilities map for *user*. Used by GET /users/me/permissions."""
    return {
        "role": user.role,
        "can_delete": can_delete(user),
        "can_import": can_import(user),
        "can_bulk_edit": can_bulk_edit(user),
        "can_manage_team": can_manage_team(user),
        "visibility_scope": user.visibility_scope,
        "actions": {
            "create_project": True,                       # all authenticated users
            "delete_project": can_delete(user),
            "import_tasks": can_import(user),
            "bulk_edit_tasks": can_bulk_edit(user),
            "manage_team": can_manage_team(user),
            "manage_departments": can_manage_team(user),
            "access_vault": True,                         # read access for all
            "upload_vault_files": True,                   # upload for all
            "delete_vault_files": can_delete_vault_files(user),
            "manage_report_settings": can_manage_projects(user),
        },
    }


# ── Enforcing checks (raise 403 + audit log on denial) ────────────────────────

async def _deny(
    db: AsyncSession | None,
    user: User,
    action: str,
    resource: str | None,
    detail: str,
) -> None:
    """Log the denial and raise 403."""
    if db is not None:
        try:
            await log_system_activity(
                db,
                source="access_control",
                category="access_denied",
                level="warning",
                message=f"Access denied: {action}",
                details={
                    "user_id": user.id,
                    "user_name": getattr(user, "name", ""),
                    "role": user.role,
                    "action": action,
                    "resource": resource,
                    "reason": detail,
                },
                commit=False,
            )
        except Exception:
            logger.warning("Failed to log access denial for user %s / action %s", user.id, action)
    raise HTTPException(status_code=403, detail=detail)


async def require_can_delete(
    user: User,
    db: AsyncSession | None = None,
    resource: str | None = None,
) -> None:
    if not can_delete(user):
        await _deny(db, user, "delete", resource, "Нет права на удаление")


async def require_can_import(
    user: User,
    db: AsyncSession | None = None,
    resource: str | None = None,
) -> None:
    if not can_import(user):
        await _deny(db, user, "import", resource, "Нет права на импорт")


async def require_can_bulk_edit(
    user: User,
    db: AsyncSession | None = None,
    resource: str | None = None,
) -> None:
    if not can_bulk_edit(user):
        await _deny(db, user, "bulk_edit", resource, "Нет права на массовое редактирование")


async def require_can_manage_team(
    user: User,
    db: AsyncSession | None = None,
    resource: str | None = None,
) -> None:
    if not can_manage_team(user):
        await _deny(db, user, "manage_team", resource, "Нет права на управление командой")


async def require_can_delete_vault(
    user: User,
    db: AsyncSession | None = None,
    resource: str | None = None,
) -> None:
    if not can_delete_vault_files(user):
        await _deny(db, user, "delete_vault_file", resource, "Нет права на удаление файлов хранилища")
