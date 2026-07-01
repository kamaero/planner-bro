"""Central permission service — single source of truth for all access checks.

Replaces the scattered require_*/can_* helpers spread across project_rules_service,
task_access_service, vault.py, and users.py.
"""
from __future__ import annotations

from typing import Any

from app.models.user import User


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
