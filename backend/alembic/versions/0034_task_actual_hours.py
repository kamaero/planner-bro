"""add actual_hours to tasks

Revision ID: 0034_task_actual_hours
Revises: 0033_user_middle_name
Create Date: 2026-03-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0034_task_actual_hours"
down_revision: Union[str, None] = "0033_user_middle_name"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("actual_hours", sa.Numeric(precision=6, scale=2), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "actual_hours")
