"""add user last_login_at timestamp

Revision ID: 0025_user_last_login
Revises: 0024_chat_attach_read_cursor
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0025_user_last_login"
down_revision = "0024_chat_attach_read_cursor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "last_login_at")
