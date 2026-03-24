"""external contractors global list

Revision ID: 0038_external_contractors
Revises: 0037_task_external_deps
Create Date: 2026-03-24
"""
from alembic import op
import sqlalchemy as sa

revision = '0038_external_contractors'
down_revision = '0037_task_external_deps'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'external_contractors',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('name', sa.String(256), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('external_contractors')
