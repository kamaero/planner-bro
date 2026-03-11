"""auth login events audit log

Revision ID: 0027_auth_login_events
Revises: 0026_status_tz_testing
Create Date: 2026-03-06
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0027_auth_login_events"
down_revision: Union[str, None] = "0026_status_tz_testing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "auth_login_events",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("email_entered", sa.String(length=255), nullable=False),
        sa.Column("normalized_email", sa.String(length=255), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("failure_reason", sa.String(length=64), nullable=True),
        sa.Column("client_ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=1024), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_auth_login_events_user_id", "auth_login_events", ["user_id"])
    op.create_index("ix_auth_login_events_normalized_email", "auth_login_events", ["normalized_email"])
    op.create_index("ix_auth_login_events_success", "auth_login_events", ["success"])
    op.create_index("ix_auth_login_events_created_at", "auth_login_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_auth_login_events_created_at", table_name="auth_login_events")
    op.drop_index("ix_auth_login_events_success", table_name="auth_login_events")
    op.drop_index("ix_auth_login_events_normalized_email", table_name="auth_login_events")
    op.drop_index("ix_auth_login_events_user_id", table_name="auth_login_events")
    op.drop_table("auth_login_events")
