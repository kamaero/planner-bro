import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    role: Mapped[str] = mapped_column(
        SAEnum("admin", "manager", "developer", name="user_role"),
        default="developer",
        nullable=False,
    )
    reminder_days: Mapped[str] = mapped_column(String(64), default="1,3", nullable=False)
    fcm_token: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    owned_projects: Mapped[list["Project"]] = relationship("Project", back_populates="owner")
    project_memberships: Mapped[list["ProjectMember"]] = relationship(
        "ProjectMember", back_populates="user"
    )
    assigned_tasks: Mapped[list["Task"]] = relationship(
        "Task", foreign_keys="Task.assigned_to_id", back_populates="assignee"
    )
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification", back_populates="user"
    )
    task_comments: Mapped[list["TaskComment"]] = relationship(
        "TaskComment", back_populates="author"
    )
