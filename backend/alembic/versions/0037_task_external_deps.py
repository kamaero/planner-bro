"""task external deps

Revision ID: 0037
Revises: 0036
Create Date: 2026-03-24
"""
from alembic import op
import sqlalchemy as sa

revision = '0037_task_external_deps'
down_revision = '0036_custom_fields'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'task_external_deps',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('task_id', sa.String(36), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('contractor_name', sa.String(256), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('due_date', sa.Date, nullable=True),
        sa.Column(
            'status',
            sa.Enum('waiting', 'testing', 'received', 'overdue', name='ext_dep_status'),
            nullable=False,
            server_default='waiting',
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('task_external_deps')
    op.execute("DROP TYPE IF EXISTS ext_dep_status")
