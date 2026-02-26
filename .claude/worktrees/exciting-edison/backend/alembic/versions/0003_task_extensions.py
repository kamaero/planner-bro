from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("reminder_days", sa.String(length=64), nullable=False, server_default="1,3"))

    op.add_column("tasks", sa.Column("is_escalation", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("tasks", sa.Column("escalation_for", sa.String(length=255), nullable=True))
    op.add_column("tasks", sa.Column("repeat_every_days", sa.Integer(), nullable=True))

    op.create_table(
        "task_comments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("task_id", sa.String(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.String(length=4000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_task_comments_task_id", "task_comments", ["task_id"])

    op.create_table(
        "task_events",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("task_id", sa.String(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("payload", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_task_events_task_id", "task_events", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_task_events_task_id", table_name="task_events")
    op.drop_table("task_events")

    op.drop_index("ix_task_comments_task_id", table_name="task_comments")
    op.drop_table("task_comments")

    op.drop_column("tasks", "repeat_every_days")
    op.drop_column("tasks", "escalation_for")
    op.drop_column("tasks", "is_escalation")

    op.drop_column("users", "reminder_days")
