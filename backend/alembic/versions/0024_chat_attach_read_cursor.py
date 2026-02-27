"""add chat attachments and read cursor

Revision ID: 0024_chat_attach_read_cursor
Revises: 0023_chat_messages
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0024_chat_attach_read_cursor"
down_revision = "0023_chat_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_attachments",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("message_id", sa.String(), nullable=False),
        sa.Column("uploaded_by_id", sa.String(), nullable=False),
        sa.Column("filename", sa.String(length=512), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("encrypted_size", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(length=1024), nullable=False),
        sa.Column("nonce", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_attachments_message_id", "chat_attachments", ["message_id"])
    op.create_index("ix_chat_attachments_uploaded_by_id", "chat_attachments", ["uploaded_by_id"])
    op.create_index("ix_chat_attachments_created_at", "chat_attachments", ["created_at"])

    op.create_table(
        "chat_read_cursors",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("global_last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_index("ix_chat_read_cursors_updated_at", "chat_read_cursors", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_chat_read_cursors_updated_at", table_name="chat_read_cursors")
    op.drop_table("chat_read_cursors")

    op.drop_index("ix_chat_attachments_created_at", table_name="chat_attachments")
    op.drop_index("ix_chat_attachments_uploaded_by_id", table_name="chat_attachments")
    op.drop_index("ix_chat_attachments_message_id", table_name="chat_attachments")
    op.drop_table("chat_attachments")

