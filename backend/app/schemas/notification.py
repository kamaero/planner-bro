from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


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


class SystemActivityLogOut(BaseModel):
    id: str
    source: str
    category: str
    level: str
    message: str
    details: Optional[dict[str, Any]] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ClientErrorReportIn(BaseModel):
    message: str
    stack: Optional[str] = None
    url: Optional[str] = None
    user_agent: Optional[str] = None
    context: Optional[dict[str, Any]] = None


class SMTPHealthCheckIn(BaseModel):
    recipient: Optional[str] = None


class SMTPHealthCheckOut(BaseModel):
    ok: bool
    recipient: str
    source: str
    message: str


class ReportDigestFilters(BaseModel):
    deadline_window_days: int = Field(default=5, ge=0, le=60)
    priorities: list[str] = Field(default_factory=lambda: ["high", "critical"])
    include_control_ski: bool = True
    include_escalations: bool = True
    include_without_deadline: bool = False
    anti_noise_enabled: bool = True
    anti_noise_ttl_minutes: int = Field(default=360, ge=15, le=1440)


class ReportDispatchSettingsOut(BaseModel):
    telegram_summaries_enabled: bool
    email_analytics_enabled: bool
    email_analytics_recipients: str
    digest_filters: ReportDigestFilters


class ReportDispatchSettingsUpdateIn(BaseModel):
    telegram_summaries_enabled: bool
    email_analytics_enabled: bool
    email_analytics_recipients: str = ""
    digest_filters: Optional[ReportDigestFilters] = None


class ReportDeliveryStatusOut(BaseModel):
    generated_at: datetime
    window_hours: int
    email_sent: int
    email_failed: int
    email_skipped: int
    telegram_sent: int
    telegram_failed: int
    last_email_sent_at: Optional[datetime] = None
    last_telegram_sent_at: Optional[datetime] = None
