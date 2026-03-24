"""Pure helper functions shared between users.py and temp_assignees.py."""
import secrets
import string


def normalize_email(email: str) -> str:
    return email.strip().lower()


def normalize_optional_email(email: str | None) -> str | None:
    if email is None:
        return None
    cleaned = email.strip().lower()
    return cleaned or None


def _normalize_name_part(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def short_name(last_name: str, first_name: str, middle_name: str) -> str:
    last = _normalize_name_part(last_name)
    first = _normalize_name_part(first_name)
    middle = _normalize_name_part(middle_name)
    if not last and not first and not middle:
        return ""
    initials = ""
    if first:
        initials += f"{first[0].upper()}."
    if middle:
        initials += f"{middle[0].upper()}."
    if last:
        return f"{last} {initials}".strip()
    return initials.strip()


def generate_temporary_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def default_permissions_for_role(role: str) -> dict[str, bool]:
    if role == "admin":
        return {
            "can_manage_team": True,
            "can_delete": True,
            "can_import": True,
            "can_bulk_edit": True,
        }
    if role == "manager":
        return {
            "can_manage_team": False,
            "can_delete": True,
            "can_import": True,
            "can_bulk_edit": True,
        }
    return {
        "can_manage_team": False,
        "can_delete": False,
        "can_import": False,
        "can_bulk_edit": False,
    }


def default_visibility_for_role(role: str) -> str:
    if role == "admin":
        return "full_scope"
    if role == "developer":
        return "own_tasks_only"
    return "department_scope"
