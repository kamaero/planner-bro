from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

# Пул кэпирован на процесс: движок форкается в каждый uvicorn-worker (4) и celery-worker (4) + beat.
# Дефолт SQLAlchemy (5+10=15/процесс) × 9 процессов = 135 > Postgres max_connections(100) → "too many clients".
# 5+3=8/процесс × 9 = 72 — с запасом под лимитом. pool_recycle сбрасывает залежавшиеся соединения.
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=3,
    pool_recycle=1800,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
