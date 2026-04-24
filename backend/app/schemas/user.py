from pydantic import BaseModel, EmailStr
from datetime import datetime, date
from typing import Optional


class UserBase(BaseModel):
    email: EmailStr
    work_email: Optional[EmailStr] = None
    name: str
    position_title: Optional[str] = None
    manager_id: Optional[str] = None
    department_id: Optional[str] = None
    role: str = "developer"
    visibility_scope: Optional[str] = None
    own_tasks_visibility_enabled: Optional[bool] = None
    can_manage_team: Optional[bool] = None
    can_delete: Optional[bool] = None
    can_import: Optional[bool] = None
    can_bulk_edit: Optional[bool] = None


class UserCreate(UserBase):
    email: Optional[EmailStr] = None  # optional: falls back to work_email if omitted
    password: str
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None


class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_url: Optional[str] = None
    position_title: Optional[str] = None
    email_notifications_enabled: Optional[bool] = None


class UserNameUpdate(BaseModel):
    first_name: str
    middle_name: Optional[str] = None
    last_name: str


class UserOut(UserBase):
    id: str
    first_name: str = ""
    middle_name: str = ""
    last_name: str = ""
    avatar_url: Optional[str] = None
    can_manage_team: bool = False
    can_delete: bool = False
    can_import: bool = False
    can_bulk_edit: bool = False
    reminder_days: str = "1,3"
    email_notifications_enabled: bool = True
    is_active: bool = True
    last_login_at: Optional[datetime] = None
    last_seen_changelog_hash: Optional[str] = None
    last_seen_changelog_date: Optional[date] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserProfile(UserOut):
    updated_at: datetime


class UserPermissionsUpdate(BaseModel):
    role: Optional[str] = None
    visibility_scope: Optional[str] = None
    own_tasks_visibility_enabled: Optional[bool] = None
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


class AuthLoginEventOut(BaseModel):
    id: str
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    user_email: Optional[EmailStr] = None
    email_entered: str
    normalized_email: str
    success: bool
    failure_reason: Optional[str] = None
    client_ip: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime


class TempAssigneeOut(BaseModel):
    id: str
    raw_name: str
    normalized_name: str
    email: Optional[EmailStr] = None
    source: str
    status: str
    linked_user_id: Optional[str] = None
    project_id: Optional[str] = None
    created_by_id: Optional[str] = None
    seen_count: int
    first_seen_at: datetime
    last_seen_at: datetime
    created_at: datetime
    updated_at: datetime
    linked_user: Optional[UserOut] = None

    model_config = {"from_attributes": True}


class TempAssigneeLinkRequest(BaseModel):
    user_id: str


class TempAssigneePromoteRequest(BaseModel):
    email: EmailStr
    work_email: Optional[EmailStr] = None
    role: str = "developer"
    password: Optional[str] = None
    position_title: Optional[str] = None
    manager_id: Optional[str] = None
    department_id: Optional[str] = None
