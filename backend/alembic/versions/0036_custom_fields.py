"""add project_custom_fields and task_custom_values tables

Revision ID: 0036_custom_fields
Revises: 0035_project_retrospective
Create Date: 2026-03-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "0036_custom_fields"
down_revision: Union[str, None] = "0035_project_retrospective"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_custom_fields",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("field_type", sa.String(20), nullable=False, server_default="text"),
        sa.Column("options", JSONB(), nullable=True),
        sa.Column("required", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_custom_fields_project_id", "project_custom_fields", ["project_id"])

    op.create_table(
        "task_custom_values",
        sa.Column("task_id", sa.String(), nullable=False),
        sa.Column("field_id", sa.String(), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["field_id"], ["project_custom_fields.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("task_id", "field_id"),
    )


def downgrade() -> None:
    op.drop_table("task_custom_values")
    op.drop_index("ix_project_custom_fields_project_id", table_name="project_custom_fields")
    op.drop_table("project_custom_fields")
