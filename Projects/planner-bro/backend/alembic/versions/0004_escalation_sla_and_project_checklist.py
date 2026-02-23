import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_CHECKLIST = [
    {"id": "scope_approved", "label": "Результаты проекта согласованы", "done": False},
    {"id": "docs_prepared", "label": "Документация и инструкции подготовлены", "done": False},
    {"id": "handover_done", "label": "Передача в сопровождение завершена", "done": False},
    {"id": "retrospective_done", "label": "Ретроспектива проведена", "done": False},
]


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "completion_checklist",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text(f"'{json.dumps(DEFAULT_CHECKLIST)}'::jsonb"),
        ),
    )

    op.add_column(
        "tasks",
        sa.Column("escalation_sla_hours", sa.Integer(), nullable=False, server_default="24"),
    )
    op.add_column("tasks", sa.Column("escalation_due_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "tasks", sa.Column("escalation_first_response_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("tasks", sa.Column("escalation_overdue_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_tasks_escalation_due_at", "tasks", ["escalation_due_at"])
    op.create_index("ix_tasks_escalation_overdue_at", "tasks", ["escalation_overdue_at"])

    op.execute(
        """
        UPDATE tasks
        SET escalation_due_at = created_at + make_interval(hours => escalation_sla_hours)
        WHERE is_escalation = true AND escalation_due_at IS NULL
        """
    )

    op.alter_column("projects", "completion_checklist", server_default=None)
    op.alter_column("tasks", "escalation_sla_hours", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_tasks_escalation_overdue_at", table_name="tasks")
    op.drop_index("ix_tasks_escalation_due_at", table_name="tasks")
    op.drop_column("tasks", "escalation_overdue_at")
    op.drop_column("tasks", "escalation_first_response_at")
    op.drop_column("tasks", "escalation_due_at")
    op.drop_column("tasks", "escalation_sla_hours")

    op.drop_column("projects", "completion_checklist")
