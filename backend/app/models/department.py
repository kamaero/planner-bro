import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    head_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    parent: Mapped["Department | None"] = relationship(
        "Department", remote_side="Department.id", back_populates="children"
    )
    children: Mapped[list["Department"]] = relationship("Department", back_populates="parent")
    head_user: Mapped["User | None"] = relationship("User", foreign_keys=[head_user_id])
    users: Mapped[list["User"]] = relationship("User", back_populates="department")
