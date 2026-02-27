"""add unified system activity logs

Revision ID: 0021_system_activity_logs
Revises: 0020
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0021_system_activity_logs"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_activity_logs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("level", sa.String(length=16), nullable=False),
        sa.Column("message", sa.String(length=1000), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_system_activity_logs_created_at", "system_activity_logs", ["created_at"])
    op.create_index("ix_system_activity_logs_source", "system_activity_logs", ["source"])
    op.create_index("ix_system_activity_logs_category", "system_activity_logs", ["category"])
    op.create_index("ix_system_activity_logs_level", "system_activity_logs", ["level"])


def downgrade() -> None:
    op.drop_index("ix_system_activity_logs_level", table_name="system_activity_logs")
    op.drop_index("ix_system_activity_logs_category", table_name="system_activity_logs")
    op.drop_index("ix_system_activity_logs_source", table_name="system_activity_logs")
    op.drop_index("ix_system_activity_logs_created_at", table_name="system_activity_logs")
    op.drop_table("system_activity_logs")
