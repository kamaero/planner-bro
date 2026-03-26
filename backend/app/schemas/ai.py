from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.user import UserOut


class AIIngestionJobOut(BaseModel):
    id: str
    project_id: str
    project_file_id: str
    status: str
    drafts_count: int
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AITaskDraftOut(BaseModel):
    id: str
    project_id: str
    project_file_id: str
    job_id: str
    status: str
    title: str
    description: Optional[str] = None
    priority: str
    end_date: Optional[date] = None
    estimated_hours: Optional[int] = None
    assigned_to_id: Optional[str] = None
    assignee_hint: Optional[str] = None
    progress_percent: int
    next_step: Optional[str] = None
    source_quote: Optional[str] = None
    confidence: int
    raw_payload: dict
    approved_task_id: Optional[str] = None
    approved_by_id: Optional[str] = None
    assignee: Optional[UserOut] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AITaskDraftBulkApproveRequest(BaseModel):
    draft_ids: list[str] = Field(default_factory=list, min_length=1)
    delete_existing_tasks: bool = False


class AITaskDraftBulkRejectRequest(BaseModel):
    draft_ids: list[str] = Field(default_factory=list, min_length=1)


class AIProcessStartRequest(BaseModel):
    prompt_instruction: Optional[str] = Field(default=None, max_length=4000)
