from datetime import datetime, timezone
import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.security import (
    verify_password,
    hash_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
)
from app.core.token_store import is_refresh_token_revoked, revoke_refresh_token
from app.models.user import User
from app.services.notification_service import _send_email_to_recipients
from app.schemas.user import (
    TokenPair,
    LoginRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    RefreshRequest,
    LogoutRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _generate_temporary_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


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

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(data: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    email = _normalize_email(data.email)
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()
    generic_msg = "Если аккаунт найден, временный пароль отправлен на вашу почту."

    if not user or not user.is_active:
        return ForgotPasswordResponse(message=generic_msg)

    temporary_password = _generate_temporary_password()
    user.password_hash = hash_password(temporary_password)
    await db.commit()

    target_email = (user.work_email or user.email or "").strip().lower()
    if target_email:
        subject = "PlannerBro: временный пароль"
        body = (
            f"Здравствуйте, {user.name}!\n\n"
            "Запрошено восстановление доступа к PlannerBro.\n"
            f"Временный пароль: {temporary_password}\n\n"
            "После входа смените пароль в настройках профиля.\n"
        )
        await _send_email_to_recipients(
            db,
            recipients=[target_email],
            subject=subject,
            body=body,
            source="auth_forgot_password",
            payload={"user_id": user.id},
        )
    return ForgotPasswordResponse(message=generic_msg)


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
