from pydantic import BaseModel
from datetime import datetime, date
from typing import Optional
from app.schemas.user import UserOut


class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "todo"
    priority: str = "medium"
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    assigned_to_id: Optional[str] = None
    parent_task_id: Optional[str] = None
    estimated_hours: Optional[int] = None


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    assigned_to_id: Optional[str] = None
    estimated_hours: Optional[int] = None


class TaskStatusUpdate(BaseModel):
    status: str


class TaskOut(TaskBase):
    id: str
    project_id: str
    created_by_id: str
    assignee: Optional[UserOut] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
