from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("progress_percent", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("tasks", sa.Column("next_step", sa.String(length=500), nullable=True))

    op.execute(
        """
        UPDATE tasks
        SET progress_percent = 100
        WHERE status = 'done'
        """
    )
    op.alter_column("tasks", "progress_percent", server_default=None)


def downgrade() -> None:
    op.drop_column("tasks", "next_step")
    op.drop_column("tasks", "progress_percent")
