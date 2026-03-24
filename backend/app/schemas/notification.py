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


class ReportDigestSchedule(BaseModel):
    timezone: str = "Asia/Yekaterinburg"
    telegram_projects_enabled: bool = True
    telegram_critical_enabled: bool = True
    email_projects_enabled: bool = True
    email_critical_enabled: bool = True
    telegram_projects_slots: list[str] = Field(default_factory=lambda: ["mon@08:00", "fri@16:00"])
    telegram_critical_slots: list[str] = Field(default_factory=lambda: ["daily@10:00"])
    email_analytics_slots: list[str] = Field(default_factory=lambda: ["mon@08:10", "fri@16:10"])


class AdminDirectiveSettings(BaseModel):
    enabled: bool = False
    recipient: str = "aerokamero@gmail.com"
    days: list[str] = Field(default_factory=lambda: ["mon", "tue", "wed", "thu", "fri"])
    time_window: str = "09:00-12:00"
    include_overdue: bool = True
    include_stale: bool = True
    stale_days: int = Field(default=7, ge=1, le=90)
    include_unassigned: bool = True
    custom_text: str = ""


class ReportDispatchSettingsOut(BaseModel):
    smtp_enabled: bool
    email_test_mode: bool = False
    email_test_recipient: str = ""
    telegram_summaries_enabled: bool
    email_analytics_enabled: bool
    email_analytics_recipients: str
    digest_filters: ReportDigestFilters
    digest_schedule: ReportDigestSchedule
    admin_directive: AdminDirectiveSettings


class ReportDispatchSettingsUpdateIn(BaseModel):
    smtp_enabled: bool
    email_test_mode: Optional[bool] = None
    email_test_recipient: Optional[str] = None
    telegram_summaries_enabled: bool
    email_analytics_enabled: bool
    email_analytics_recipients: str = ""
    digest_filters: Optional[ReportDigestFilters] = None
    digest_schedule: Optional[ReportDigestSchedule] = None
    admin_directive: Optional[AdminDirectiveSettings] = None


class AdminDirectiveTestIn(BaseModel):
    recipient: Optional[str] = None


class AdminDirectiveTestOut(BaseModel):
    ok: bool
    recipient: str
    sent: bool
    overdue_count: int
    stale_count: int
    unassigned_count: int
    message: str


class SourceDeliveryStats(BaseModel):
    source: str
    sent: int
    failed: int
    skipped: int
    error_rate: float  # percentage (0–100)
    last_sent_at: Optional[datetime] = None
    last_error: Optional[str] = None


class ReportDeliveryStatusOut(BaseModel):
    generated_at: datetime
    window_hours: int
    email_sent: int
    email_failed: int
    email_skipped: int
    source_stats: list[SourceDeliveryStats] = []
    telegram_sent: int
    telegram_failed: int
    last_email_sent_at: Optional[datetime] = None
    last_telegram_sent_at: Optional[datetime] = None
