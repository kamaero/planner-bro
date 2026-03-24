"""
Secure Team Vault — encrypted file storage.

Security model:
  • All files are AES-256-GCM encrypted at rest (per-file key via HKDF).
  • Downloads require a short-lived signed JWT (15 min) to prevent URL sharing.
  • Upload/delete require authentication; delete also requires admin or can_delete perm.
  • The encryption master key is read from VAULT_ENCRYPTION_KEY env var.
"""
import uuid
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.vault import VaultFile
from app.schemas.vault import VaultFileOut, VaultDownloadTokenOut
from app.services.vault_crypto import (
    encrypt_file,
    decrypt_file,
    create_download_token,
    verify_download_token,
    DOWNLOAD_TOKEN_EXPIRE_MINUTES,
)

router = APIRouter(prefix="/vault", tags=["vault"])
logger = logging.getLogger(__name__)

MAX_VAULT_FILE_SIZE = 100 * 1024 * 1024   # 100 MB hard limit


def _vault_key() -> str:
    """Return master encryption key hex string, falling back to SECRET_KEY if not configured."""
    key = settings.VAULT_ENCRYPTION_KEY
    if not key:
        import hashlib
        # Derive 32-byte key from SECRET_KEY via SHA-256 (deterministic fallback)
        key = hashlib.sha256(settings.SECRET_KEY.encode()).hexdigest()
        logger.warning(
            "VAULT_ENCRYPTION_KEY not set — using SECRET_KEY-derived key. "
            "Set VAULT_ENCRYPTION_KEY in .env for production."
        )
    return key


def _require_delete_permission(user: User) -> None:
    from app.services.permission_service import can_delete
    if not can_delete(user):
        raise HTTPException(status_code=403, detail="Нет права на удаление файлов хранилища")


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

@router.post("/files", response_model=VaultFileOut, status_code=201)
async def upload_vault_file(
    upload: UploadFile = File(...),
    folder: str | None = Query(default=None, max_length=255),
    description: str | None = Query(default=None, max_length=2000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Filename required")

    plaintext = await upload.read()
    if len(plaintext) > MAX_VAULT_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 100 MB limit")
    if len(plaintext) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    file_id = str(uuid.uuid4())
    ciphertext, nonce = encrypt_file(_vault_key(), file_id, plaintext)

    vault_dir = Path(settings.VAULT_FILES_DIR)
    vault_dir.mkdir(parents=True, exist_ok=True)
    storage_path = vault_dir / file_id

    storage_path.write_bytes(ciphertext)

    record = VaultFile(
        id=file_id,
        name=upload.filename,
        description=description,
        content_type=upload.content_type,
        size=len(plaintext),
        encrypted_size=len(ciphertext),
        storage_path=str(storage_path),
        nonce=nonce,
        folder=folder,
        uploaded_by_id=current_user.id,
    )
    db.add(record)
    await db.commit()

    result = await db.execute(
        select(VaultFile).where(VaultFile.id == file_id)
        .options(selectinload(VaultFile.uploaded_by))
    )
    return result.scalar_one()


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("/files", response_model=list[VaultFileOut])
async def list_vault_files(
    folder: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(VaultFile)
        .options(selectinload(VaultFile.uploaded_by))
        .order_by(VaultFile.created_at.desc())
        .limit(500)
    )
    if folder is not None:
        stmt = stmt.where(VaultFile.folder == folder)
    result = await db.execute(stmt)
    return result.scalars().all()


# ---------------------------------------------------------------------------
# Download token
# ---------------------------------------------------------------------------

@router.get("/files/{file_id}/token", response_model=VaultDownloadTokenOut)
async def get_download_token(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = (await db.execute(
        select(VaultFile).where(VaultFile.id == file_id)
    )).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    token = create_download_token(file_id, current_user.id, settings.SECRET_KEY)
    return VaultDownloadTokenOut(
        token=token,
        expires_in_seconds=DOWNLOAD_TOKEN_EXPIRE_MINUTES * 60,
        download_url=f"/api/v1/vault/files/{file_id}/download?token={token}",
    )


# ---------------------------------------------------------------------------
# Download (decrypt and stream)
# ---------------------------------------------------------------------------

@router.get("/files/{file_id}/download")
async def download_vault_file(
    file_id: str,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Download endpoint — authenticated via signed token only (no Bearer header required
    so the browser can follow a direct link / open in new tab).
    """
    record = (await db.execute(
        select(VaultFile).where(VaultFile.id == file_id)
    )).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    # Decode token to get user_id for verification
    from jose import jwt as jose_jwt, JWTError
    try:
        claims = jose_jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id = claims.get("sub", "")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired download token")

    if not verify_download_token(token, settings.SECRET_KEY, file_id, user_id):
        raise HTTPException(status_code=401, detail="Invalid or expired download token")

    encrypted_path = Path(record.storage_path)
    if not encrypted_path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")

    ciphertext = encrypted_path.read_bytes()
    try:
        plaintext = decrypt_file(_vault_key(), file_id, ciphertext, record.nonce)
    except Exception:
        raise HTTPException(status_code=500, detail="Decryption failed — file may be corrupt")

    content_type = record.content_type or "application/octet-stream"
    safe_name = record.name.replace('"', '')
    return Response(
        content=plaintext,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete("/files/{file_id}", status_code=204)
async def delete_vault_file(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_delete_permission(current_user)

    record = (await db.execute(
        select(VaultFile).where(VaultFile.id == file_id)
    )).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    path = Path(record.storage_path)
    if path.exists():
        path.unlink()

    await db.delete(record)
    await db.commit()
