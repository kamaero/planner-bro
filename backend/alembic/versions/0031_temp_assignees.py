"""temp assignees registry

Revision ID: 0031_temp_assignees
Revises: 0030_own_tasks_toggle
Create Date: 2026-03-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0031_temp_assignees"
down_revision: Union[str, None] = "0030_own_tasks_toggle"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


temp_assignee_status = sa.Enum(
    "pending",
    "linked",
    "promoted",
    "ignored",
    name="temp_assignee_status",
)


def upgrade() -> None:
    bind = op.get_bind()
    temp_assignee_status.create(bind, checkfirst=True)

    op.create_table(
        "temp_assignees",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("raw_name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("status", temp_assignee_status, nullable=False),
        sa.Column("linked_user_id", sa.String(), nullable=True),
        sa.Column("project_id", sa.String(), nullable=True),
        sa.Column("created_by_id", sa.String(), nullable=True),
        sa.Column("seen_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["linked_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_temp_assignees_normalized_name", "temp_assignees", ["normalized_name"], unique=False)
    op.create_index("ix_temp_assignees_email", "temp_assignees", ["email"], unique=False)
    op.create_index("ix_temp_assignees_linked_user_id", "temp_assignees", ["linked_user_id"], unique=False)
    op.create_index("ix_temp_assignees_project_id", "temp_assignees", ["project_id"], unique=False)
    op.create_index("ix_temp_assignees_created_by_id", "temp_assignees", ["created_by_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_temp_assignees_created_by_id", table_name="temp_assignees")
    op.drop_index("ix_temp_assignees_project_id", table_name="temp_assignees")
    op.drop_index("ix_temp_assignees_linked_user_id", table_name="temp_assignees")
    op.drop_index("ix_temp_assignees_email", table_name="temp_assignees")
    op.drop_index("ix_temp_assignees_normalized_name", table_name="temp_assignees")
    op.drop_table("temp_assignees")
    bind = op.get_bind()
    temp_assignee_status.drop(bind, checkfirst=True)
