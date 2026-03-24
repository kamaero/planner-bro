from datetime import datetime, date
from uuid import uuid4

from sqlalchemy import String, Text, Date, DateTime, ForeignKey, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TaskExternalDep(Base):
    __tablename__ = "task_external_deps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    task_id: Mapped[str] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    contractor_name: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # stored status; effective status may be 'overdue' when due_date is past and status='waiting'
    status: Mapped[str] = mapped_column(
        SAEnum("waiting", "testing", "received", "overdue", name="ext_dep_status"),
        nullable=False,
        default="waiting",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
