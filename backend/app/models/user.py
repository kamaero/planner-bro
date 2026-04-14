import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Enum as SAEnum, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    work_email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    first_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    middle_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    last_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    position_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    manager_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    department_id: Mapped[str | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    role: Mapped[str] = mapped_column(
        SAEnum("admin", "manager", "developer", name="user_role"),
        default="developer",
        nullable=False,
    )
    visibility_scope: Mapped[str] = mapped_column(
        SAEnum("own_tasks_only", "department_scope", "full_scope", name="user_visibility_scope"),
        default="department_scope",
        nullable=False,
    )
    own_tasks_visibility_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    can_manage_team: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_delete: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_import: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_bulk_edit: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reminder_days: Mapped[str] = mapped_column(String(64), default="1,3", nullable=False)
    email_notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="true")
    fcm_token: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
    assigned_task_links: Mapped[list["TaskAssignee"]] = relationship("TaskAssignee")
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification", back_populates="user"
    )
    task_comments: Mapped[list["TaskComment"]] = relationship(
        "TaskComment", back_populates="author"
    )
    manager: Mapped["User | None"] = relationship(
        "User", remote_side="User.id", back_populates="subordinates"
    )
    subordinates: Mapped[list["User"]] = relationship("User", back_populates="manager")
    department: Mapped["Department | None"] = relationship(
        "Department",
        back_populates="users",
        foreign_keys=[department_id],
    )
    auth_login_events: Mapped[list["AuthLoginEvent"]] = relationship("AuthLoginEvent")
