from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional


class UserBase(BaseModel):
    email: EmailStr
    name: str
    role: str = "developer"


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    avatar_url: Optional[str] = None


class UserOut(UserBase):
    id: str
    avatar_url: Optional[str] = None
    reminder_days: str = "1,3"
    created_at: datetime

    model_config = {"from_attributes": True}


class UserProfile(UserOut):
    updated_at: datetime


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class GoogleOAuthRequest(BaseModel):
    code: str
    redirect_uri: str


class ReminderSettingsUpdate(BaseModel):
    reminder_days: str
