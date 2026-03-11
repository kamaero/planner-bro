"""add dependency type and lag to task dependencies

Revision ID: 0032_task_dependency_types
Revises: 0031_temp_assignees
Create Date: 2026-03-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0032_task_dependency_types"
down_revision: Union[str, None] = "0031_temp_assignees"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


task_dependency_type = postgresql.ENUM(
    "finish_to_start",
    "start_to_start",
    "finish_to_finish",
    name="task_dependency_type",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    task_dependency_type.create(bind, checkfirst=True)

    op.add_column(
        "task_dependencies",
        sa.Column(
            "dependency_type",
            task_dependency_type,
            nullable=False,
            server_default="finish_to_start",
        ),
    )
    op.add_column(
        "task_dependencies",
        sa.Column("lag_days", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("task_dependencies", "dependency_type", server_default=None)
    op.alter_column("task_dependencies", "lag_days", server_default=None)


def downgrade() -> None:
    op.drop_column("task_dependencies", "lag_days")
    op.drop_column("task_dependencies", "dependency_type")
    bind = op.get_bind()
    task_dependency_type.drop(bind, checkfirst=True)
