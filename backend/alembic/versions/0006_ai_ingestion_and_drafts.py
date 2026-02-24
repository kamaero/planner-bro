from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ai_job_status = postgresql.ENUM(
    "queued", "processing", "completed", "failed", name="ai_job_status", create_type=False
)
_ai_draft_status = postgresql.ENUM(
    "pending", "approved", "rejected", name="ai_draft_status", create_type=False
)


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DO $$ BEGIN CREATE TYPE ai_job_status AS ENUM "
            "('queued','processing','completed','failed'); "
            "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
        )
    )
    conn.execute(
        sa.text(
            "DO $$ BEGIN CREATE TYPE ai_draft_status AS ENUM "
            "('pending','approved','rejected'); "
            "EXCEPTION WHEN duplicate_object THEN NULL; END $$"
        )
    )

    op.create_table(
        "ai_ingestion_jobs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "project_file_id",
            sa.String(),
            sa.ForeignKey("project_files.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_by_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", _ai_job_status, nullable=False, server_default="queued"),
        sa.Column("drafts_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.String(length=2000), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ai_ingestion_jobs_project_id", "ai_ingestion_jobs", ["project_id"])
    op.create_index("ix_ai_ingestion_jobs_project_file_id", "ai_ingestion_jobs", ["project_file_id"])

    op.create_table(
        "ai_task_drafts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("project_id", sa.String(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "project_file_id",
            sa.String(),
            sa.ForeignKey("project_files.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "job_id",
            sa.String(),
            sa.ForeignKey("ai_ingestion_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", _ai_draft_status, nullable=False, server_default="pending"),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.String(length=5000), nullable=True),
        sa.Column("priority", sa.String(length=32), nullable=False, server_default="medium"),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("estimated_hours", sa.Integer(), nullable=True),
        sa.Column("assigned_to_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assignee_hint", sa.String(length=255), nullable=True),
        sa.Column("progress_percent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_step", sa.String(length=500), nullable=True),
        sa.Column("source_quote", sa.String(length=2000), nullable=True),
        sa.Column("confidence", sa.Integer(), nullable=False, server_default="60"),
        sa.Column(
            "raw_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("approved_task_id", sa.String(), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_by_id", sa.String(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ai_task_drafts_project_id", "ai_task_drafts", ["project_id"])
    op.create_index("ix_ai_task_drafts_project_file_id", "ai_task_drafts", ["project_file_id"])
    op.create_index("ix_ai_task_drafts_job_id", "ai_task_drafts", ["job_id"])

    op.alter_column("ai_ingestion_jobs", "status", server_default=None)
    op.alter_column("ai_ingestion_jobs", "drafts_count", server_default=None)
    op.alter_column("ai_task_drafts", "status", server_default=None)
    op.alter_column("ai_task_drafts", "priority", server_default=None)
    op.alter_column("ai_task_drafts", "progress_percent", server_default=None)
    op.alter_column("ai_task_drafts", "confidence", server_default=None)
    op.alter_column("ai_task_drafts", "raw_payload", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_ai_task_drafts_job_id", table_name="ai_task_drafts")
    op.drop_index("ix_ai_task_drafts_project_file_id", table_name="ai_task_drafts")
    op.drop_index("ix_ai_task_drafts_project_id", table_name="ai_task_drafts")
    op.drop_table("ai_task_drafts")

    op.drop_index("ix_ai_ingestion_jobs_project_file_id", table_name="ai_ingestion_jobs")
    op.drop_index("ix_ai_ingestion_jobs_project_id", table_name="ai_ingestion_jobs")
    op.drop_table("ai_ingestion_jobs")

    op.execute("DROP TYPE IF EXISTS ai_draft_status")
    op.execute("DROP TYPE IF EXISTS ai_job_status")
