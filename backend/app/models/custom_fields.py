import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Integer, Boolean, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class ProjectCustomField(Base):
    """Field definition at the project level."""
    __tablename__ = "project_custom_fields"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # text | number | date | select
    field_type: Mapped[str] = mapped_column(String(20), nullable=False, default="text")
    # For select type: list of option strings stored as JSON array
    options: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class TaskCustomValue(Base):
    """Field value stored per task."""
    __tablename__ = "task_custom_values"

    task_id: Mapped[str] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    field_id: Mapped[str] = mapped_column(
        ForeignKey("project_custom_fields.id", ondelete="CASCADE"), primary_key=True
    )
    # All values stored as text; frontend converts based on field_type
    value: Mapped[str | None] = mapped_column(Text, nullable=True)

    field: Mapped["ProjectCustomField"] = relationship("ProjectCustomField")
