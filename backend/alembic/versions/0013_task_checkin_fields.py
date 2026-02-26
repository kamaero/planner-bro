from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("last_check_in_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("next_check_in_due_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("last_check_in_note", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "last_check_in_note")
    op.drop_column("tasks", "next_check_in_due_at")
    op.drop_column("tasks", "last_check_in_at")
