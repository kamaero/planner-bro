from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("can_manage_team", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "users",
        sa.Column("can_delete", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "users",
        sa.Column("can_import", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "users",
        sa.Column("can_bulk_edit", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.execute(
        """
        UPDATE users
        SET
            can_manage_team = CASE WHEN role = 'admin' THEN true ELSE false END,
            can_delete = CASE WHEN role IN ('admin', 'manager') THEN true ELSE false END,
            can_import = CASE WHEN role IN ('admin', 'manager') THEN true ELSE false END,
            can_bulk_edit = CASE WHEN role IN ('admin', 'manager') THEN true ELSE false END
        """
    )

    op.alter_column("users", "can_manage_team", server_default=None)
    op.alter_column("users", "can_delete", server_default=None)
    op.alter_column("users", "can_import", server_default=None)
    op.alter_column("users", "can_bulk_edit", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "can_bulk_edit")
    op.drop_column("users", "can_import")
    op.drop_column("users", "can_delete")
    op.drop_column("users", "can_manage_team")
