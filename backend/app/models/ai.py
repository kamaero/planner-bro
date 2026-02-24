import uuid
from datetime import datetime, date, timezone

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AIIngestionJob(Base):
    __tablename__ = "ai_ingestion_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_file_id: Mapped[str] = mapped_column(
        ForeignKey("project_files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        SAEnum("queued", "processing", "completed", "failed", name="ai_job_status"),
        default="queued",
        nullable=False,
    )
    drafts_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    project_file: Mapped["ProjectFile"] = relationship("ProjectFile")
    drafts: Mapped[list["AITaskDraft"]] = relationship(
        "AITaskDraft", back_populates="job", cascade="all, delete-orphan"
    )


class AITaskDraft(Base):
    __tablename__ = "ai_task_drafts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_file_id: Mapped[str] = mapped_column(
        ForeignKey("project_files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_id: Mapped[str] = mapped_column(
        ForeignKey("ai_ingestion_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        SAEnum("pending", "approved", "rejected", name="ai_draft_status"),
        default="pending",
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(String(5000), nullable=True)
    priority: Mapped[str] = mapped_column(String(32), default="medium", nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    estimated_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assigned_to_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assignee_hint: Mapped[str | None] = mapped_column(String(255), nullable=True)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_step: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_quote: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    confidence: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    raw_payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    approved_task_id: Mapped[str | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    approved_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    job: Mapped["AIIngestionJob"] = relationship("AIIngestionJob", back_populates="drafts")
    project_file: Mapped["ProjectFile"] = relationship("ProjectFile")
    assignee: Mapped["User | None"] = relationship("User", foreign_keys=[assigned_to_id])

