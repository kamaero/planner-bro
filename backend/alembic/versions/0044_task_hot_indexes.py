"""add indexes on hot tasks columns (end_date, status, assigned_to_id, parent_task_id)

The hourly deadline sweep filters tasks by end_date (== today+1/+3 and < today),
workload/my-tasks views filter by assigned_to_id, subtask trees filter by
parent_task_id, and status is filtered widely — none were indexed, so these were
sequential scans on the tasks table.

Revision ID: 0044_task_hot_indexes
Revises: 0043_project_reporting_scope
Create Date: 2026-07-01
"""
from alembic import op

revision = '0044_task_hot_indexes'
down_revision = '0043_project_reporting_scope'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_end_date ON tasks (end_date)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_status ON tasks (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_assigned_to_id ON tasks (assigned_to_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_parent_task_id ON tasks (parent_task_id)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_tasks_parent_task_id")
    op.execute("DROP INDEX IF EXISTS ix_tasks_assigned_to_id")
    op.execute("DROP INDEX IF EXISTS ix_tasks_status")
    op.execute("DROP INDEX IF EXISTS ix_tasks_end_date")
