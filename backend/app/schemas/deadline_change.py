from pydantic import BaseModel
from datetime import datetime, date
from typing import Optional
from app.schemas.user import UserOut


class DeadlineChangeOut(BaseModel):
    id: str
    entity_type: str
    entity_id: str
    old_date: date
    new_date: date
    reason: str
    created_at: datetime
    changed_by: Optional[UserOut] = None

    model_config = {"from_attributes": True}


class DeadlineStats(BaseModel):
    total_shifts: int
    tasks_with_shifts: int
    projects_with_shifts: int
    avg_shift_days: float
    real_overdue_tasks: list[dict]
    shifts_by_project: list[dict]
