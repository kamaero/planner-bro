from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional


class UserBase(BaseModel):
    email: EmailStr
    work_email: Optional[EmailStr] = None
    name: str
    position_title: Optional[str] = None
    manager_id: Optional[str] = None
    department_id: Optional[str] = None
    role: str = "developer"
    can_manage_team: Optional[bool] = None
    can_delete: Optional[bool] = None
    can_import: Optional[bool] = None
    can_bulk_edit: Optional[bool] = None


class UserCreate(UserBase):
    password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_url: Optional[str] = None
    position_title: Optional[str] = None


class UserNameUpdate(BaseModel):
    first_name: str
    last_name: str


class UserOut(UserBase):
    id: str
    first_name: str = ""
    last_name: str = ""
    avatar_url: Optional[str] = None
    can_manage_team: bool = False
    can_delete: bool = False
    can_import: bool = False
    can_bulk_edit: bool = False
    reminder_days: str = "1,3"
    is_active: bool = True
    last_login_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserProfile(UserOut):
    updated_at: datetime


class UserPermissionsUpdate(BaseModel):
    role: Optional[str] = None
    work_email: Optional[EmailStr] = None
    position_title: Optional[str] = None
    manager_id: Optional[str] = None
    department_id: Optional[str] = None
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


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str


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


class ChangeMyPasswordRequest(BaseModel):
    current_password: str
    new_password: str


class DepartmentBase(BaseModel):
    name: str
    parent_id: Optional[str] = None
    head_user_id: Optional[str] = None


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None
    head_user_id: Optional[str] = None


class DepartmentOut(DepartmentBase):
    id: str
    created_at: datetime

    model_config = {"from_attributes": True}
