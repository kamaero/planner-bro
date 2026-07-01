from datetime import date
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.report import StatusSnapshotReport
from app.services.report_pptx_service import build_report_filename, build_status_report_pptx, convert_pptx_to_pdf
from app.services.status_snapshot_service import build_status_snapshot_report

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/status-snapshot", response_model=StatusSnapshotReport)
async def get_status_snapshot_report(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    department_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await build_status_snapshot_report(
        db,
        current_user=current_user,
        from_date=from_date,
        to_date=to_date,
        department_id=department_id,
    )


@router.get("/status-snapshot/presentation")
async def download_status_snapshot_presentation(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    department_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    report = await build_status_snapshot_report(
        db,
        current_user=current_user,
        from_date=from_date,
        to_date=to_date,
        department_id=department_id,
    )
    try:
        payload = build_status_report_pptx(report, settings.REPORT_PPTX_TEMPLATE_PATH)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    filename = build_report_filename(report)
    return StreamingResponse(
        BytesIO(payload),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/status-snapshot/presentation.pdf")
async def download_status_snapshot_presentation_pdf(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    department_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    report = await build_status_snapshot_report(
        db,
        current_user=current_user,
        from_date=from_date,
        to_date=to_date,
        department_id=department_id,
    )
    try:
        pptx_payload = build_status_report_pptx(report, settings.REPORT_PPTX_TEMPLATE_PATH)
        filename = build_report_filename(report, suffix="pdf")
        payload = convert_pptx_to_pdf(pptx_payload, filename_stem=filename.removesuffix(".pdf"))
    except (FileNotFoundError, RuntimeError) as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return StreamingResponse(
        BytesIO(payload),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
