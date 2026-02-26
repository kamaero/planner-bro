"""email dispatch logs for sidebar activity monitor

Revision ID: 0019_email_dispatch_logs
Revises: 0018_task_status_planning
Create Date: 2026-02-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0019_email_dispatch_logs"
down_revision = "0018_task_status_planning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_dispatch_logs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("recipient", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("error_text", sa.String(length=1000), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_dispatch_logs_created_at", "email_dispatch_logs", ["created_at"])
    op.create_index("ix_email_dispatch_logs_recipient", "email_dispatch_logs", ["recipient"])
    op.create_index("ix_email_dispatch_logs_source", "email_dispatch_logs", ["source"])
    op.create_index("ix_email_dispatch_logs_status", "email_dispatch_logs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_email_dispatch_logs_status", table_name="email_dispatch_logs")
    op.drop_index("ix_email_dispatch_logs_source", table_name="email_dispatch_logs")
    op.drop_index("ix_email_dispatch_logs_recipient", table_name="email_dispatch_logs")
    op.drop_index("ix_email_dispatch_logs_created_at", table_name="email_dispatch_logs")
    op.drop_table("email_dispatch_logs")
