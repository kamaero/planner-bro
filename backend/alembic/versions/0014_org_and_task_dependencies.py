from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "departments",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("parent_id", sa.String(), nullable=True),
        sa.Column("head_user_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["parent_id"], ["departments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["head_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    op.add_column("users", sa.Column("position_title", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("manager_id", sa.String(), nullable=True))
    op.add_column("users", sa.Column("department_id", sa.String(), nullable=True))
    op.create_index("ix_users_manager_id", "users", ["manager_id"], unique=False)
    op.create_index("ix_users_department_id", "users", ["department_id"], unique=False)
    op.create_foreign_key("fk_users_manager_id", "users", "users", ["manager_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key(
        "fk_users_department_id",
        "users",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "task_dependencies",
        sa.Column("predecessor_task_id", sa.String(), nullable=False),
        sa.Column("successor_task_id", sa.String(), nullable=False),
        sa.Column("created_by_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["predecessor_task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["successor_task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("predecessor_task_id", "successor_task_id"),
    )


def downgrade() -> None:
    op.drop_table("task_dependencies")

    op.drop_constraint("fk_users_department_id", "users", type_="foreignkey")
    op.drop_constraint("fk_users_manager_id", "users", type_="foreignkey")
    op.drop_index("ix_users_department_id", table_name="users")
    op.drop_index("ix_users_manager_id", table_name="users")
    op.drop_column("users", "department_id")
    op.drop_column("users", "manager_id")
    op.drop_column("users", "position_title")

    op.drop_table("departments")
