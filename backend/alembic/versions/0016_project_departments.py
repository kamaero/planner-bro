from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_departments",
        sa.Column("project_id", sa.String(), nullable=False),
        sa.Column("department_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "department_id"),
    )
    op.create_index(
        "ix_project_departments_department_id",
        "project_departments",
        ["department_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_project_departments_department_id", table_name="project_departments")
    op.drop_table("project_departments")

