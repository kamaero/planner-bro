from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Any


class NotificationOut(BaseModel):
    id: str
    user_id: str
    type: str
    title: str
    body: str
    data: Optional[dict] = None
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class DeviceRegisterRequest(BaseModel):
    token: str
    platform: str = "android"  # android | web


class EmailDispatchLogOut(BaseModel):
    id: str
    recipient: str
    recipient_masked: str
    subject: str
    status: str
    source: str
    error_text: Optional[str] = None
    payload: Optional[dict[str, Any]] = None
    created_at: datetime
