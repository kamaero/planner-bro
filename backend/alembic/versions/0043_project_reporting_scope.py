"""add project reporting scope fields

Revision ID: 0043_project_reporting_scope
Revises: 0042_changelog_seen
Create Date: 2026-06-03
"""
from alembic import op
import sqlalchemy as sa

revision = '0043_project_reporting_scope'
down_revision = '0042_changelog_seen'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'projects',
        sa.Column('project_kind', sa.String(64), nullable=False, server_default='major_project'),
    )
    op.add_column(
        'projects',
        sa.Column('report_visibility', sa.String(32), nullable=False, server_default='always'),
    )
    op.add_column(
        'projects',
        sa.Column('report_track', sa.String(64), nullable=False, server_default='main'),
    )
    op.alter_column('projects', 'project_kind', server_default=None)
    op.alter_column('projects', 'report_visibility', server_default=None)
    op.alter_column('projects', 'report_track', server_default=None)


def downgrade():
    op.drop_column('projects', 'report_track')
    op.drop_column('projects', 'report_visibility')
    op.drop_column('projects', 'project_kind')
