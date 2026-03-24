from datetime import datetime
from uuid import uuid4

from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExternalContractor(Base):
    __tablename__ = "external_contractors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
