import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EmailDispatchLog(Base):
    __tablename__ = "email_dispatch_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    recipient: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    error_text: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
