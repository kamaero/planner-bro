"""add planning status for tasks

Revision ID: 0018_task_status_planning
Revises: 0017_task_assignees
Create Date: 2026-02-26
"""

from alembic import op


revision = "0018_task_status_planning"
down_revision = "0017_task_assignees"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'planning'")
    op.execute("ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'planning'")


def downgrade() -> None:
    # PostgreSQL cannot drop enum values safely in-place.
    op.execute("ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'todo'")
