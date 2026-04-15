"""add task_number to tasks

Revision ID: 0041_task_number
Revises: 0040_email_notifications_enabled
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = '0041_task_number'
down_revision = '0040_email_notifications_enabled'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'tasks',
        sa.Column('task_number', sa.String(50), nullable=True),
    )


def downgrade():
    op.drop_column('tasks', 'task_number')
