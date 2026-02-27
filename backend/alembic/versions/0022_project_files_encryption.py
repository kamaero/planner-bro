"""add encryption metadata to project files

Revision ID: 0022_project_files_encryption
Revises: 0021_system_activity_logs
Create Date: 2026-02-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0022_project_files_encryption"
down_revision = "0021_system_activity_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("project_files", sa.Column("encrypted_size", sa.Integer(), nullable=True))
    op.add_column(
        "project_files",
        sa.Column("is_encrypted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("project_files", sa.Column("nonce", sa.String(length=64), nullable=True))
    op.alter_column("project_files", "is_encrypted", server_default=None)


def downgrade() -> None:
    op.drop_column("project_files", "nonce")
    op.drop_column("project_files", "is_encrypted")
    op.drop_column("project_files", "encrypted_size")

