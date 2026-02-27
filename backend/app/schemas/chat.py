from datetime import datetime

from pydantic import BaseModel, Field


class ChatAttachmentOut(BaseModel):
    id: str
    filename: str
    content_type: str | None = None
    size: int
    created_at: datetime
    download_url: str


class ChatMessageOut(BaseModel):
    id: str
    room_type: str
    sender_id: str
    sender_name: str
    recipient_id: str | None = None
    body: str
    attachments: list[ChatAttachmentOut] = Field(default_factory=list)
    read_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": False}


class ChatMessageCreate(BaseModel):
    room_type: str = Field(default="direct")
    recipient_id: str | None = None
    body: str = Field(min_length=1, max_length=2000)


class ChatUnreadItem(BaseModel):
    user_id: str
    unread_count: int


class ChatUnreadSummaryOut(BaseModel):
    global_unread_count: int
    direct: list[ChatUnreadItem] = Field(default_factory=list)
