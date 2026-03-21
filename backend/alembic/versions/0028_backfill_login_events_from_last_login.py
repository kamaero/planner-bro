"""backfill auth_login_events from users.last_login_at

Revision ID: 0028_backfill_last_login
Revises: 0027_auth_login_events
Create Date: 2026-03-06
"""

from typing import Sequence, Union

from alembic import op


revision: str = "0028_backfill_last_login"
down_revision: Union[str, None] = "0027_auth_login_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO auth_login_events (
            id,
            user_id,
            email_entered,
            normalized_email,
            success,
            failure_reason,
            client_ip,
            user_agent,
            created_at
        )
        SELECT
            'backfill-' || u.id,
            u.id,
            u.email,
            lower(u.email),
            true,
            NULL,
            NULL,
            'legacy_backfill',
            u.last_login_at
        FROM users u
        WHERE u.is_active = true
          AND u.last_login_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM auth_login_events e
            WHERE e.user_id = u.id
              AND e.success = true
              AND e.created_at = u.last_login_at
          )
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM auth_login_events WHERE id LIKE 'backfill-%'")
