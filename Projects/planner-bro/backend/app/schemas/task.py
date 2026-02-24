from pydantic import BaseModel, Field
from datetime import datetime, date
from typing import Optional
from app.schemas.user import UserOut


class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "todo"
    priority: str = "medium"
    progress_percent: int = Field(default=0, ge=0, le=100)
    next_step: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    assigned_to_id: Optional[str] = None
    parent_task_id: Optional[str] = None
    estimated_hours: Optional[int] = None
    is_escalation: bool = False
    escalation_for: Optional[str] = None
    escalation_sla_hours: int = 24
    escalation_due_at: Optional[datetime] = None
    escalation_first_response_at: Optional[datetime] = None
    escalation_overdue_at: Optional[datetime] = None
    repeat_every_days: Optional[int] = None


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    progress_percent: Optional[int] = Field(default=None, ge=0, le=100)
    next_step: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    assigned_to_id: Optional[str] = None
    estimated_hours: Optional[int] = None
    parent_task_id: Optional[str] = None
    is_escalation: Optional[bool] = None
    escalation_for: Optional[str] = None
    escalation_sla_hours: Optional[int] = None
    escalation_due_at: Optional[datetime] = None
    escalation_first_response_at: Optional[datetime] = None
    escalation_overdue_at: Optional[datetime] = None
    repeat_every_days: Optional[int] = None


class TaskStatusUpdate(BaseModel):
    status: str
    progress_percent: Optional[int] = Field(default=None, ge=0, le=100)
    next_step: Optional[str] = None


class TaskOut(TaskBase):
    id: str
    project_id: str
    created_by_id: str
    assignee: Optional[UserOut] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TaskCommentCreate(BaseModel):
    body: str


class TaskCommentOut(BaseModel):
    id: str
    task_id: str
    author_id: Optional[str] = None
    body: str
    created_at: datetime
    author: Optional[UserOut] = None

    model_config = {"from_attributes": True}


class TaskEventOut(BaseModel):
    id: str
    task_id: str
    actor_id: Optional[str] = None
    event_type: str
    payload: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
