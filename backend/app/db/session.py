from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings


def async_url(url: str) -> str:
    """Supabase gives postgresql:// URLs; SQLAlchemy needs the asyncpg driver named."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix) :]
    return url


@cache
def get_engine() -> AsyncEngine:
    url = get_settings().database_url
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return create_async_engine(
        async_url(url),
        pool_pre_ping=True,
        connect_args={"timeout": 10, "command_timeout": 15},
    )


@asynccontextmanager
async def session() -> AsyncIterator[AsyncSession]:
    """One unit of work: commits on success, rolls back on error."""
    async with async_sessionmaker(get_engine(), expire_on_commit=False)() as db:
        try:
            yield db
            await db.commit()
        except Exception:
            await db.rollback()
            raise
