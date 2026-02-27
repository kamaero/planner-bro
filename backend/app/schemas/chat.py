from datetime import datetime

from pydantic import BaseModel, Field


class ChatMessageOut(BaseModel):
    id: str
    room_type: str
    sender_id: str
    recipient_id: str | None = None
    body: str
    read_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageCreate(BaseModel):
    room_type: str = Field(default="direct")
    recipient_id: str | None = None
    body: str = Field(min_length=1, max_length=2000)
