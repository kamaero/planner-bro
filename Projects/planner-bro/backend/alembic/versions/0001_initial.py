"""Initial migration

Revision ID: 0001
Revises:
Create Date: 2026-02-22

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enums
    user_role = postgresql.ENUM("admin", "manager", "developer", name="user_role")
    project_status = postgresql.ENUM("planning", "active", "on_hold", "completed", name="project_status")
    member_role = postgresql.ENUM("owner", "manager", "member", name="member_role")
    task_status = postgresql.ENUM("todo", "in_progress", "review", "done", name="task_status")
    task_priority = postgresql.ENUM("low", "medium", "high", "critical", name="task_priority")
    notification_type = postgresql.ENUM(
        "deadline_approaching", "deadline_missed", "task_assigned",
        "task_updated", "project_updated", "new_task",
        name="notification_type",
    )

    user_role.create(op.get_bind(), checkfirst=True)
    project_status.create(op.get_bind(), checkfirst=True)
    member_role.create(op.get_bind(), checkfirst=True)
    task_status.create(op.get_bind(), checkfirst=True)
    task_priority.create(op.get_bind(), checkfirst=True)
    notification_type.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("avatar_url", sa.String(512), nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("google_id", sa.String(255), unique=True, nullable=True),
        sa.Column("role", sa.Enum("admin", "manager", "developer", name="user_role"), nullable=False, server_default="developer"),
        sa.Column("fcm_token", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "projects",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.String(2000), nullable=True),
        sa.Column("color", sa.String(7), nullable=False, server_default="#6366f1"),
        sa.Column("status", sa.Enum("planning", "active", "on_hold", "completed", name="project_status"), nullable=False, server_default="planning"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("owner_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "project_members",
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.Enum("owner", "manager", "member", name="member_role"), nullable=False, server_default="member"),
    )

    op.create_table(
        "tasks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_task_id", sa.String(), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.String(5000), nullable=True),
        sa.Column("status", sa.Enum("todo", "in_progress", "review", "done", name="task_status"), nullable=False, server_default="todo"),
        sa.Column("priority", sa.Enum("low", "medium", "high", "critical", name="task_priority"), nullable=False, server_default="medium"),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("assigned_to_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("estimated_hours", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_tasks_project_id", "tasks", ["project_id"])

    op.create_table(
        "notifications",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.Enum(
            "deadline_approaching", "deadline_missed", "task_assigned",
            "task_updated", "project_updated", "new_task",
            name="notification_type",
        ), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.String(1000), nullable=False),
        sa.Column("data", postgresql.JSONB(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_table("tasks")
    op.drop_table("project_members")
    op.drop_table("projects")
    op.drop_table("users")

    op.execute("DROP TYPE IF EXISTS notification_type")
    op.execute("DROP TYPE IF EXISTS task_priority")
    op.execute("DROP TYPE IF EXISTS task_status")
    op.execute("DROP TYPE IF EXISTS member_role")
    op.execute("DROP TYPE IF EXISTS project_status")
    op.execute("DROP TYPE IF EXISTS user_role")
