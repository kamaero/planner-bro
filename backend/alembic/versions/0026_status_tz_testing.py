from typing import Sequence, Union

from alembic import op


revision: str = "0026_status_tz_testing"
down_revision: Union[str, None] = "0025_user_last_login"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'tz'")
    op.execute("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'testing'")
    op.execute("ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'tz'")
    op.execute("ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'testing'")


def downgrade() -> None:
    # PostgreSQL enum value removal is not straightforward and can break existing rows.
    # Keep downgrade as no-op to avoid unsafe enum rewrites.
    pass
