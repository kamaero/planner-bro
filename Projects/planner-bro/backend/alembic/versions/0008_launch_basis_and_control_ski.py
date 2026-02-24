from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_project_priority = postgresql.ENUM(
    "low", "medium", "high", "critical", name="project_priority", create_type=False
)


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DO $$ BEGIN CREATE TYPE project_priority AS ENUM "
            "('low','medium','high','critical'); "
            "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
        )
    )

    op.add_column(
        "projects",
        sa.Column("priority", _project_priority, nullable=False, server_default="medium"),
    )
    op.alter_column("projects", "priority", server_default=None)
    op.add_column(
        "projects",
        sa.Column("control_ski", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.alter_column("projects", "control_ski", server_default=None)
    op.add_column(
        "projects",
        sa.Column("launch_basis_text", sa.String(length=2000), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("launch_basis_file_id", sa.String(), nullable=True),
    )
    op.create_foreign_key(
        "fk_projects_launch_basis_file",
        "projects",
        "project_files",
        ["launch_basis_file_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "tasks",
        sa.Column("control_ski", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.alter_column("tasks", "control_ski", server_default=None)


def downgrade() -> None:
    op.drop_column("tasks", "control_ski")

    op.drop_constraint("fk_projects_launch_basis_file", "projects", type_="foreignkey")
    op.drop_column("projects", "launch_basis_file_id")
    op.drop_column("projects", "launch_basis_text")
    op.drop_column("projects", "control_ski")
    op.drop_column("projects", "priority")

    op.execute("DROP TYPE IF EXISTS project_priority")
