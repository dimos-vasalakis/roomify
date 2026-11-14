from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import cache
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy.exc import ProgrammingError, SQLAlchemyError
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


async def db_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency. Saved data is off in replay mode, which must run with no network."""
    settings = get_settings()
    if settings.replay:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Saved conversations are not available in replay mode.",
        )
    if not settings.database_url:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Database is not configured: set DATABASE_URL."
        )
    try:
        async with session() as db:
            yield db
    except ProgrammingError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Database setup is incomplete. Run alembic upgrade head on the backend.",
        ) from exc
    except (SQLAlchemyError, OSError, TimeoutError) as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Cannot connect to the database. Check the backend DATABASE_URL and database availability.",
        ) from exc


# scope="function": commit before the response goes out, so a 2xx means it is saved.
DB = Annotated[AsyncSession, Depends(db_session, scope="function")]
