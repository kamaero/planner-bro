from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0020"
down_revision: Union[str, None] = "0019_email_dispatch_logs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("first_name", sa.String(128), nullable=True))
    op.add_column("users", sa.Column("last_name", sa.String(128), nullable=True))

    # Auto-split existing name: first word → first_name, rest → last_name
    op.execute("""
        UPDATE users
        SET
            first_name = SPLIT_PART(name, ' ', 1),
            last_name  = CASE
                           WHEN POSITION(' ' IN name) > 0
                           THEN TRIM(SUBSTRING(name FROM POSITION(' ' IN name) + 1))
                           ELSE ''
                         END
    """)

    op.alter_column("users", "first_name", nullable=False)
    op.alter_column("users", "last_name", nullable=False)


def downgrade() -> None:
    op.drop_column("users", "first_name")
    op.drop_column("users", "last_name")
