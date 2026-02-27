from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.chat import ChatMessage
from app.models.user import User
from app.schemas.chat import ChatMessageCreate, ChatMessageOut
from app.services import events as ev
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/global/messages", response_model=list[ChatMessageOut])
async def list_global_messages(
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ = current_user
    rows = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.room_type == "global")
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return list(reversed(rows))


@router.get("/direct/{peer_id}/messages", response_model=list[ChatMessageOut])
async def list_direct_messages(
    peer_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if peer_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot open direct chat with yourself")

    peer = (await db.execute(select(User.id).where(User.id == peer_id, User.is_active == True))).scalar_one_or_none()  # noqa: E712
    if not peer:
        raise HTTPException(status_code=404, detail="Peer user not found")

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
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    # Mark incoming messages as read when the thread is opened.
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
    return list(reversed(rows))


@router.post("/messages", response_model=ChatMessageOut, status_code=201)
async def send_message(
    data: ChatMessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    room_type = (data.room_type or "direct").strip().lower()
    if room_type not in ("global", "direct"):
        raise HTTPException(status_code=400, detail="room_type must be one of: global, direct")

    recipient_id = data.recipient_id
    if room_type == "direct":
        if not recipient_id:
            raise HTTPException(status_code=400, detail="recipient_id is required for direct chat")
        if recipient_id == current_user.id:
            raise HTTPException(status_code=400, detail="Cannot send direct message to yourself")
        peer = (await db.execute(select(User.id).where(User.id == recipient_id, User.is_active == True))).scalar_one_or_none()  # noqa: E712
        if not peer:
            raise HTTPException(status_code=404, detail="Recipient user not found")
    else:
        recipient_id = None

    msg = ChatMessage(
        room_type=room_type,
        sender_id=current_user.id,
        recipient_id=recipient_id,
        body=data.body.strip(),
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    payload = {
        "id": msg.id,
        "room_type": msg.room_type,
        "sender_id": msg.sender_id,
        "recipient_id": msg.recipient_id,
        "body": msg.body,
        "read_at": msg.read_at.isoformat() if msg.read_at else None,
        "created_at": msg.created_at.isoformat(),
    }

    if room_type == "global":
        # Send to all connected users (current + online team members).
        all_ids = (await db.execute(select(User.id).where(User.is_active == True))).scalars().all()  # noqa: E712
        for uid in all_ids:
            await ws_manager.send_to_user(uid, ev.CHAT_MESSAGE, payload)
    else:
        await ws_manager.send_to_user(current_user.id, ev.CHAT_MESSAGE, payload)
        await ws_manager.send_to_user(recipient_id, ev.CHAT_MESSAGE, payload)

    return msg

