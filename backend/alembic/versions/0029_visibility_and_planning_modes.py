"""visibility scopes and project planning modes

Revision ID: 0029_modes_scopes
Revises: 0028_backfill_last_login
Create Date: 2026-03-06
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0029_modes_scopes"
down_revision: Union[str, None] = "0028_backfill_last_login"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    visibility_enum = sa.Enum(
        "own_tasks_only", "department_scope", "full_scope", name="user_visibility_scope"
    )
    visibility_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "users",
        sa.Column(
            "visibility_scope",
            visibility_enum,
            nullable=False,
            server_default="department_scope",
        ),
    )
    op.execute(
        """
        UPDATE users
        SET visibility_scope = CASE
            WHEN role = 'admin' THEN 'full_scope'::user_visibility_scope
            WHEN role = 'developer' THEN 'own_tasks_only'::user_visibility_scope
            ELSE 'department_scope'::user_visibility_scope
        END
        """
    )
    op.alter_column("users", "visibility_scope", server_default=None)

    planning_enum = sa.Enum("flexible", "strict", name="project_planning_mode")
    planning_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "projects",
        sa.Column(
            "planning_mode",
            planning_enum,
            nullable=False,
            server_default="flexible",
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "strict_no_past_start_date",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "strict_no_past_end_date",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "strict_child_within_parent_dates",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.alter_column("projects", "planning_mode", server_default=None)
    op.alter_column("projects", "strict_no_past_start_date", server_default=None)
    op.alter_column("projects", "strict_no_past_end_date", server_default=None)
    op.alter_column("projects", "strict_child_within_parent_dates", server_default=None)


def downgrade() -> None:
    op.drop_column("projects", "strict_child_within_parent_dates")
    op.drop_column("projects", "strict_no_past_end_date")
    op.drop_column("projects", "strict_no_past_start_date")
    op.drop_column("projects", "planning_mode")
    sa.Enum(name="project_planning_mode").drop(op.get_bind(), checkfirst=True)

    op.drop_column("users", "visibility_scope")
    sa.Enum(name="user_visibility_scope").drop(op.get_bind(), checkfirst=True)
