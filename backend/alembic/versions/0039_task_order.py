"""task order field for drag-and-drop sorting

Revision ID: 0039_task_order
Revises: 0038_external_contractors
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = '0039_task_order'
down_revision = '0038_external_contractors'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tasks', sa.Column('order', sa.Float(), nullable=True))


def downgrade():
    op.drop_column('tasks', 'order')
