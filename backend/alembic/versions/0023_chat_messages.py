"""add team chat messages

Revision ID: 0023_chat_messages
Revises: 0022_project_files_encryption
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0023_chat_messages"
down_revision = "0022_project_files_encryption"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "DO $$ BEGIN "
        "CREATE TYPE chat_room_type AS ENUM ('global','direct'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("sender_id", sa.String(), nullable=False),
        sa.Column("room_type", sa.Enum("global", "direct", name="chat_room_type"), nullable=False),
        sa.Column("recipient_id", sa.String(), nullable=True),
        sa.Column("body", sa.String(length=2000), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["recipient_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_sender_id", "chat_messages", ["sender_id"])
    op.create_index("ix_chat_messages_recipient_id", "chat_messages", ["recipient_id"])
    op.create_index("ix_chat_messages_room_type", "chat_messages", ["room_type"])
    op.create_index("ix_chat_messages_created_at", "chat_messages", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_chat_messages_created_at", table_name="chat_messages")
    op.drop_index("ix_chat_messages_room_type", table_name="chat_messages")
    op.drop_index("ix_chat_messages_recipient_id", table_name="chat_messages")
    op.drop_index("ix_chat_messages_sender_id", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.execute("DROP TYPE IF EXISTS chat_room_type")

