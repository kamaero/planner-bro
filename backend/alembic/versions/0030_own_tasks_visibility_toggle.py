"""add own tasks visibility toggle

Revision ID: 0030_own_tasks_toggle
Revises: 0029_modes_scopes
Create Date: 2026-03-06
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0030_own_tasks_toggle"
down_revision: Union[str, None] = "0029_modes_scopes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "own_tasks_visibility_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.alter_column("users", "own_tasks_visibility_enabled", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "own_tasks_visibility_enabled")
