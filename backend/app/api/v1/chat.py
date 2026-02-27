import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.chat import ChatAttachment, ChatMessage, ChatReadCursor
from app.models.user import User
from app.schemas.chat import (
    ChatAttachmentOut,
    ChatMessageCreate,
    ChatMessageOut,
    ChatUnreadItem,
    ChatUnreadSummaryOut,
)
from app.services import events as ev
from app.services.chat_storage import read_chat_attachment_bytes, store_chat_attachment_encrypted
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/chat", tags=["chat"])


def _serialize_message(msg: ChatMessage) -> ChatMessageOut:
    attachments = [
        ChatAttachmentOut(
            id=a.id,
            filename=a.filename,
            content_type=a.content_type,
            size=a.size,
            created_at=a.created_at,
            download_url=f"/api/v1/chat/attachments/{a.id}/download",
        )
        for a in sorted(msg.attachments, key=lambda x: x.created_at)
    ]
    return ChatMessageOut(
        id=msg.id,
        room_type=msg.room_type,
        sender_id=msg.sender_id,
        sender_name=msg.sender.name if msg.sender else msg.sender_id,
        recipient_id=msg.recipient_id,
        body=msg.body,
        attachments=attachments,
        read_at=msg.read_at,
        created_at=msg.created_at,
    )


async def _mark_global_read(db: AsyncSession, user_id: str) -> None:
    now = datetime.now(timezone.utc)
    cursor = (await db.execute(select(ChatReadCursor).where(ChatReadCursor.user_id == user_id))).scalar_one_or_none()
    if cursor:
        cursor.global_last_read_at = now
    else:
        db.add(ChatReadCursor(user_id=user_id, global_last_read_at=now))
    await db.flush()


async def _require_direct_peer(db: AsyncSession, current_user_id: str, peer_id: str) -> None:
    if peer_id == current_user_id:
        raise HTTPException(status_code=400, detail="Cannot open direct chat with yourself")
    peer = (
        await db.execute(select(User.id).where(User.id == peer_id, User.is_active == True))  # noqa: E712
    ).scalar_one_or_none()
    if not peer:
        raise HTTPException(status_code=404, detail="Peer user not found")


@router.get("/global/messages", response_model=list[ChatMessageOut])
async def list_global_messages(
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.room_type == "global")
            .options(selectinload(ChatMessage.sender), selectinload(ChatMessage.attachments))
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    await _mark_global_read(db, current_user.id)
    await db.commit()
    return [_serialize_message(m) for m in reversed(rows)]


@router.get("/direct/{peer_id}/messages", response_model=list[ChatMessageOut])
async def list_direct_messages(
    peer_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_direct_peer(db, current_user.id, peer_id)
    rows = (
        await db.execute(
            select(ChatMessage)
            .where(
                ChatMessage.room_type == "direct",
                or_(
                    and_(ChatMessage.sender_id == current_user.id, ChatMessage.recipient_id == peer_id),
                    and_(ChatMessage.sender_id == peer_id, ChatMessage.recipient_id == current_user.id),
                ),
            )
            .options(selectinload(ChatMessage.sender), selectinload(ChatMessage.attachments))
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    await db.execute(
        update(ChatMessage)
        .where(
            ChatMessage.room_type == "direct",
            ChatMessage.sender_id == peer_id,
            ChatMessage.recipient_id == current_user.id,
            ChatMessage.read_at.is_(None),
        )
        .values(read_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return [_serialize_message(m) for m in reversed(rows)]


@router.get("/unread-summary", response_model=ChatUnreadSummaryOut)
async def get_unread_summary(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cursor = (
        await db.execute(select(ChatReadCursor).where(ChatReadCursor.user_id == current_user.id))
    ).scalar_one_or_none()
    global_cutoff = cursor.global_last_read_at if cursor else None
    global_stmt = select(func.count(ChatMessage.id)).where(
        ChatMessage.room_type == "global",
        ChatMessage.sender_id != current_user.id,
    )
    if global_cutoff is not None:
        global_stmt = global_stmt.where(ChatMessage.created_at > global_cutoff)
    global_count = (await db.execute(global_stmt)).scalar_one() or 0

    direct_rows = (
        await db.execute(
            select(ChatMessage.sender_id, func.count(ChatMessage.id))
            .where(
                ChatMessage.room_type == "direct",
                ChatMessage.recipient_id == current_user.id,
                ChatMessage.read_at.is_(None),
            )
            .group_by(ChatMessage.sender_id)
        )
    ).all()
    direct = [ChatUnreadItem(user_id=user_id, unread_count=count) for user_id, count in direct_rows]
    return ChatUnreadSummaryOut(global_unread_count=int(global_count), direct=direct)


async def _create_message(
    db: AsyncSession,
    *,
    sender_id: str,
    room_type: str,
    recipient_id: str | None,
    body: str,
) -> ChatMessage:
    if room_type == "direct":
        if not recipient_id:
            raise HTTPException(status_code=400, detail="recipient_id is required for direct chat")
        if recipient_id == sender_id:
            raise HTTPException(status_code=400, detail="Cannot send direct message to yourself")
        await _require_direct_peer(db, sender_id, recipient_id)
    else:
        recipient_id = None

    msg = ChatMessage(
        room_type=room_type,
        sender_id=sender_id,
        recipient_id=recipient_id,
        body=body.strip(),
    )
    db.add(msg)
    await db.flush()
    return msg


async def _broadcast_message(db: AsyncSession, msg: ChatMessage) -> None:
    full = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.id == msg.id)
            .options(selectinload(ChatMessage.sender), selectinload(ChatMessage.attachments))
        )
    ).scalar_one()
    payload = _serialize_message(full).model_dump(mode="json")
    if full.room_type == "global":
        all_ids = (await db.execute(select(User.id).where(User.is_active == True))).scalars().all()  # noqa: E712
        for uid in all_ids:
            await ws_manager.send_to_user(uid, ev.CHAT_MESSAGE, payload)
    else:
        await ws_manager.send_to_user(full.sender_id, ev.CHAT_MESSAGE, payload)
        if full.recipient_id:
            await ws_manager.send_to_user(full.recipient_id, ev.CHAT_MESSAGE, payload)


@router.post("/messages", response_model=ChatMessageOut, status_code=201)
async def send_message(
    data: ChatMessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    room_type = (data.room_type or "direct").strip().lower()
    if room_type not in ("global", "direct"):
        raise HTTPException(status_code=400, detail="room_type must be one of: global, direct")
    body = data.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message body is empty")
    msg = await _create_message(
        db,
        sender_id=current_user.id,
        room_type=room_type,
        recipient_id=data.recipient_id,
        body=body,
    )
    await db.commit()
    await _broadcast_message(db, msg)
    full = (
        await db.execute(
            select(ChatMessage).where(ChatMessage.id == msg.id).options(selectinload(ChatMessage.sender), selectinload(ChatMessage.attachments))
        )
    ).scalar_one()
    return _serialize_message(full)


@router.post("/messages/upload", response_model=ChatMessageOut, status_code=201)
async def send_message_with_attachment(
    room_type: str = Form(default="direct"),
    recipient_id: str | None = Form(default=None),
    body: str | None = Form(default=None),
    upload: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    room_type = (room_type or "direct").strip().lower()
    if room_type not in ("global", "direct"):
        raise HTTPException(status_code=400, detail="room_type must be one of: global, direct")
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Filename required")
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    text = (body or "").strip() or f"[Вложение] {upload.filename}"
    msg = await _create_message(
        db,
        sender_id=current_user.id,
        room_type=room_type,
        recipient_id=recipient_id,
        body=text,
    )

    att = ChatAttachment(
        id=str(uuid.uuid4()),
        message_id=msg.id,
        uploaded_by_id=current_user.id,
        filename=upload.filename,
        content_type=upload.content_type,
        size=len(content),
        encrypted_size=0,
        storage_path="",
        nonce="",
    )
    storage_path, nonce, encrypted_size = store_chat_attachment_encrypted(att.id, content)
    att.storage_path = storage_path
    att.nonce = nonce
    att.encrypted_size = encrypted_size
    db.add(att)
    await db.commit()

    await _broadcast_message(db, msg)
    full = (
        await db.execute(
            select(ChatMessage).where(ChatMessage.id == msg.id).options(selectinload(ChatMessage.sender), selectinload(ChatMessage.attachments))
        )
    ).scalar_one()
    return _serialize_message(full)


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attachment = (
        await db.execute(
            select(ChatAttachment)
            .where(ChatAttachment.id == attachment_id)
            .options(selectinload(ChatAttachment.message))
        )
    ).scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    message = attachment.message
    if not message:
        raise HTTPException(status_code=404, detail="Attachment message not found")

    if message.room_type == "direct":
        allowed = current_user.id in {message.sender_id, message.recipient_id}
        if not allowed:
            raise HTTPException(status_code=403, detail="No access to this attachment")

    try:
        payload = read_chat_attachment_bytes(attachment)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Attachment blob missing on disk")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not decrypt attachment: {exc}")

    headers = {"Content-Disposition": f'attachment; filename="{attachment.filename}"'}
    return StreamingResponse(
        io.BytesIO(payload),
        media_type=attachment.content_type or "application/octet-stream",
        headers=headers,
    )
