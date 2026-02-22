from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from sqlalchemy import select

from app.core.config import settings
from app.core.database import engine
from app.core.firebase import init_firebase
from app.core.security import decode_token
from app.api.v1 import auth, projects, tasks, users, notifications
from app.services.websocket_manager import ws_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_firebase()
    yield


app = FastAPI(
    title="planner-bro API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    from app.core.database import AsyncSessionLocal
    from app.models.user import User
    from app.models.project import ProjectMember

    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            await websocket.close(code=4001)
            return
        user_id = payload.get("sub")
    except Exception:
        await websocket.close(code=4001)
        return

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            await websocket.close(code=4001)
            return

        # Get user's project IDs
        member_result = await db.execute(
            select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
        )
        project_ids = [row[0] for row in member_result.all()]

    await ws_manager.connect(websocket, user_id, project_ids)
    try:
        while True:
            data = await websocket.receive_text()
            # Heartbeat / ping handling
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, user_id, project_ids)
