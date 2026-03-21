import asyncio
import logging
import traceback

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from sqlalchemy import select, text

from app.core.config import settings
from app.core.database import engine, AsyncSessionLocal
from app.core.firebase import init_firebase
from app.core.security import decode_token
from app.api.v1 import auth, projects, tasks, users, notifications, vault, chat, analytics
from app.services.websocket_manager import ws_manager
from app.services.system_activity_service import log_system_activity_standalone

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def _ws_cleanup_loop() -> None:
    """Periodically evict WebSocket connections silent for > 90 s."""
    while True:
        await asyncio.sleep(60)
        try:
            removed = await ws_manager.cleanup_stale(timeout_seconds=90)
            if removed:
                logger.warning("WS cleanup: removed %d stale connections", removed)
        except Exception as exc:
            logger.error("WS cleanup error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_firebase()
    cleanup_task = asyncio.create_task(_ws_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()


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


@app.middleware("http")
async def capture_unhandled_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:
        await log_system_activity_standalone(
            source="backend",
            category="backend_error",
            level="error",
            message=f"{request.method} {request.url.path} failed: {exc.__class__.__name__}",
            details={
                "error": str(exc),
                "path": request.url.path,
                "method": request.method,
                "query": dict(request.query_params),
                "traceback": traceback.format_exc(limit=20),
            },
        )
        raise

# Routers
app.include_router(auth.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(vault.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")


@app.get("/health")
async def health():
    import redis.asyncio as aioredis

    checks: dict[str, object] = {}

    # Database reachability
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception as exc:
        logger.error("Health DB check failed: %s", exc)
        checks["db"] = "error"

    # Redis reachability
    try:
        r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception as exc:
        logger.error("Health Redis check failed: %s", exc)
        checks["redis"] = "error"

    checks["ws_connections"] = len(ws_manager._socket_user)

    status = (
        "ok"
        if all(v == "ok" for k, v in checks.items() if k != "ws_connections")
        else "degraded"
    )
    return {"status": status, **checks}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
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

        member_result = await db.execute(
            select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
        )
        project_ids = [row[0] for row in member_result.all()]

    await ws_manager.connect(websocket, user_id, project_ids)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                ws_manager.record_ping(websocket)
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
