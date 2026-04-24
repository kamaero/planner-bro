"""add changelog seen tracking to users

Revision ID: 0042_changelog_seen
Revises: 0041_task_number
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa

revision = '0042_changelog_seen'
down_revision = '0041_task_number'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('last_seen_changelog_hash', sa.String(64), nullable=True))
    op.add_column('users', sa.Column('last_seen_changelog_date', sa.Date(), nullable=True))


def downgrade():
    op.drop_column('users', 'last_seen_changelog_date')
    op.drop_column('users', 'last_seen_changelog_hash')
