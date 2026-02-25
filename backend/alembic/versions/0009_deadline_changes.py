from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "deadline_changes",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("entity_type", sa.String(10), nullable=False),
        sa.Column("entity_id", sa.String(), nullable=False),
        sa.Column("changed_by_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("old_date", sa.Date(), nullable=False),
        sa.Column("new_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_deadline_changes_entity",
        "deadline_changes",
        ["entity_type", "entity_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_deadline_changes_entity", table_name="deadline_changes")
    op.drop_table("deadline_changes")
