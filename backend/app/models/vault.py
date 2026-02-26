import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class VaultFile(Base):
    __tablename__ = "vault_files"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(512), nullable=False)          # original filename
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int] = mapped_column(Integer, nullable=False)              # plaintext size (bytes)
    encrypted_size: Mapped[int] = mapped_column(Integer, nullable=False)    # ciphertext size on disk
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False) # path to encrypted blob
    nonce: Mapped[str] = mapped_column(String(64), nullable=False)          # base64 AES-GCM nonce
    folder: Mapped[str | None] = mapped_column(String(255), nullable=True)  # virtual folder
    uploaded_by_id: Mapped[str | None] = mapped_column(
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

    uploaded_by: Mapped["User"] = relationship("User")
