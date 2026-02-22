import uuid
from datetime import datetime, date, timezone
from sqlalchemy import String, DateTime, Date, ForeignKey, Integer, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_task_id: Mapped[str | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(String(5000), nullable=True)
    status: Mapped[str] = mapped_column(
        SAEnum("todo", "in_progress", "review", "done", name="task_status"),
        default="todo",
        nullable=False,
    )
    priority: Mapped[str] = mapped_column(
        SAEnum("low", "medium", "high", "critical", name="task_priority"),
        default="medium",
        nullable=False,
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    assigned_to_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    estimated_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    project: Mapped["Project"] = relationship("Project", back_populates="tasks")
    subtasks: Mapped[list["Task"]] = relationship("Task", back_populates="parent_task")
    parent_task: Mapped["Task | None"] = relationship(
        "Task", back_populates="subtasks", remote_side="Task.id"
    )
    assignee: Mapped["User | None"] = relationship(
        "User", foreign_keys=[assigned_to_id], back_populates="assigned_tasks"
    )
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by_id])
