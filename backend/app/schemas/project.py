import re
from pydantic import BaseModel, Field, ValidationInfo, field_validator
from datetime import datetime, date
from typing import Optional, List
from app.schemas.user import UserOut

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _ensure_iso_date_string(value: object, field_name: str) -> object:
    if value is None or isinstance(value, date):
        return value
    if isinstance(value, str) and _ISO_DATE_RE.fullmatch(value):
        return value
    raise ValueError(f"{field_name} must be in YYYY-MM-DD format")


class ProjectChecklistItem(BaseModel):
    id: str
    label: str
    done: bool = False


class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#6366f1"
    status: str = "planning"
    priority: str = "medium"
    control_ski: bool = False
    launch_basis_text: Optional[str] = None
    launch_basis_file_id: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    department_ids: List[str] = Field(default_factory=list)
    completion_checklist: List[ProjectChecklistItem] = Field(default_factory=list)

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def validate_date_fields(cls, value: object, info: ValidationInfo) -> object:
        return _ensure_iso_date_string(value, info.field_name)


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    control_ski: Optional[bool] = None
    launch_basis_text: Optional[str] = None
    launch_basis_file_id: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    department_ids: Optional[List[str]] = None
    owner_id: Optional[str] = None
    completion_checklist: Optional[List[ProjectChecklistItem]] = None
    deadline_change_reason: Optional[str] = None

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def validate_date_fields(cls, value: object, info: ValidationInfo) -> object:
        return _ensure_iso_date_string(value, info.field_name)


class ProjectOut(ProjectBase):
    id: str
    owner_id: str
    owner: UserOut
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectMemberOut(BaseModel):
    user: UserOut
    role: str

    model_config = {"from_attributes": True}


class AddMemberRequest(BaseModel):
    user_id: str
    role: str = "member"


class UpdateMemberRoleRequest(BaseModel):
    role: str


class ProjectFileOut(BaseModel):
    id: str
    project_id: str
    filename: str
    content_type: Optional[str] = None
    size: int
    uploaded_by_id: Optional[str] = None
    uploaded_by: Optional[UserOut] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MSProjectImportResult(BaseModel):
    total_in_file: int
    created: int
    linked_to_parent: int
    skipped: int


# Gantt format for gantt-task-react
class GanttTask(BaseModel):
    id: str
    name: str
    start: str  # ISO date string
    end: str
    progress: float
    dependencies: List[str] = []
    type: str = "task"
    project: str
    assignee: Optional[str] = None
    color: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None


class GanttData(BaseModel):
    tasks: List[GanttTask]


class DepartmentProjectsSection(BaseModel):
    department_id: str
    department_name: str
    projects: List[ProjectOut]


class DepartmentProjectsResponse(BaseModel):
    departments: List[DepartmentProjectsSection]
