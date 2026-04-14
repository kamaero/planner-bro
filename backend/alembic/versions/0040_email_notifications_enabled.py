"""add email_notifications_enabled to users

Revision ID: 0040_email_notifications_enabled
Revises: 0039_task_order
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = '0040_email_notifications_enabled'
down_revision = '0039_task_order'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'users',
        sa.Column(
            'email_notifications_enabled',
            sa.Boolean(),
            nullable=False,
            server_default='true',
        ),
    )


def downgrade():
    op.drop_column('users', 'email_notifications_enabled')
