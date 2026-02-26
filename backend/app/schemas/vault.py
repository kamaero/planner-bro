from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from app.schemas.user import UserOut


class VaultFileOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    content_type: Optional[str] = None
    size: int
    folder: Optional[str] = None
    uploaded_by_id: Optional[str] = None
    uploaded_by: Optional[UserOut] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class VaultDownloadTokenOut(BaseModel):
    token: str
    expires_in_seconds: int
    download_url: str
