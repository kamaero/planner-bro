"""add middle_name and normalize user short names

Revision ID: 0033_user_middle_name
Revises: 0032_task_dependency_types
Create Date: 2026-03-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0033_user_middle_name"
down_revision: Union[str, None] = "0032_task_dependency_types"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("middle_name", sa.String(length=128), nullable=False, server_default=""),
    )
    op.alter_column("users", "middle_name", server_default=None)
    op.execute(
        """
        UPDATE users
        SET name = TRIM(
            CONCAT(
                COALESCE(NULLIF(last_name, ''), ''),
                CASE WHEN COALESCE(NULLIF(last_name, ''), '') <> '' AND (
                    COALESCE(NULLIF(first_name, ''), '') <> '' OR COALESCE(NULLIF(middle_name, ''), '') <> ''
                ) THEN ' ' ELSE '' END,
                CASE WHEN COALESCE(NULLIF(first_name, ''), '') <> ''
                    THEN UPPER(SUBSTRING(first_name FROM 1 FOR 1)) || '.'
                    ELSE ''
                END,
                CASE WHEN COALESCE(NULLIF(middle_name, ''), '') <> ''
                    THEN UPPER(SUBSTRING(middle_name FROM 1 FOR 1)) || '.'
                    ELSE ''
                END
            )
        )
        """
    )


def downgrade() -> None:
    op.drop_column("users", "middle_name")
