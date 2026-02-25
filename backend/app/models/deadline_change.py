import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


def _now_utc():
    return datetime.now(timezone.utc)


class DeadlineChange(Base):
    __tablename__ = "deadline_changes"

    id: str = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    entity_type: str = Column(String(10), nullable=False)  # 'task' | 'project'
    entity_id: str = Column(String, nullable=False)
    changed_by_id: str | None = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    old_date = Column(Date, nullable=False)
    new_date = Column(Date, nullable=False)
    reason: str = Column(String(1000), nullable=False)
    created_at: datetime = Column(DateTime(timezone=True), default=_now_utc)

    changed_by = relationship("User", foreign_keys=[changed_by_id])
