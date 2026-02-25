from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
)
from app.core.token_store import is_refresh_token_revoked, revoke_refresh_token
from app.models.user import User
from app.schemas.user import (
    TokenPair,
    LoginRequest,
    RefreshRequest,
    LogoutRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _normalize_email(email: str) -> str:
    return email.strip().lower()


@router.post("/register", response_model=TokenPair, status_code=201)
async def register():
    raise HTTPException(
        status_code=403,
        detail="Self-registration is disabled. Ask your admin to create an account.",
    )


@router.post("/login", response_model=TokenPair)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    email = _normalize_email(data.email)
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")

    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(data: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(data.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    jti = payload.get("jti")
    exp = payload.get("exp")
    if not jti or not exp:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if await is_refresh_token_revoked(jti):
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")

    # Refresh token rotation: old token becomes unusable after first refresh.
    await revoke_refresh_token(jti, exp)

    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/logout")
async def logout(
    data: LogoutRequest,
    current_user: User = Depends(get_current_user),
):
    payload = decode_token(data.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    if payload.get("sub") != current_user.id:
        raise HTTPException(status_code=401, detail="Refresh token does not belong to current user")

    jti = payload.get("jti")
    exp = payload.get("exp")
    if not jti or not exp:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    await revoke_refresh_token(jti, exp)
    return {"message": "Logged out"}


@router.post("/google", response_model=TokenPair)
async def google_oauth():
    raise HTTPException(
        status_code=403,
        detail="Google OAuth is disabled. Use email/password login.",
    )
