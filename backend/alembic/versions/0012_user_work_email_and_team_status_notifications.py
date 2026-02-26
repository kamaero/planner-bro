from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("work_email", sa.String(length=255), nullable=True))
    op.create_index("ix_users_work_email", "users", ["work_email"], unique=True)
    op.execute("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'team_status_reminder'")


def downgrade() -> None:
    op.drop_index("ix_users_work_email", table_name="users")
    op.drop_column("users", "work_email")
