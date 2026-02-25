from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional


class UserBase(BaseModel):
    email: EmailStr
    name: str
    role: str = "developer"
    can_manage_team: Optional[bool] = None
    can_delete: Optional[bool] = None
    can_import: Optional[bool] = None
    can_bulk_edit: Optional[bool] = None


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    avatar_url: Optional[str] = None


class UserOut(UserBase):
    id: str
    avatar_url: Optional[str] = None
    can_manage_team: bool = False
    can_delete: bool = False
    can_import: bool = False
    can_bulk_edit: bool = False
    reminder_days: str = "1,3"
    is_active: bool = True
    created_at: datetime

    model_config = {"from_attributes": True}


class UserProfile(UserOut):
    updated_at: datetime


class UserPermissionsUpdate(BaseModel):
    role: Optional[str] = None
    can_manage_team: Optional[bool] = None
    can_delete: Optional[bool] = None
    can_import: Optional[bool] = None
    can_bulk_edit: Optional[bool] = None


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


class ResetPasswordResponse(BaseModel):
    temporary_password: str
