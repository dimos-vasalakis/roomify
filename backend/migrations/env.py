import asyncio
from logging.config import fileConfig
from typing import Any

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.db.session import async_url
from app.db.tables import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def include_object(
    obj: Any, name: str | None, type_: str, reflected: bool, compare_to: Any
) -> bool:
    # auth.users belongs to Supabase: referenced by runs.user_id, never created or dropped here.
    return not (type_ == "table" and getattr(obj, "schema", None) == "auth")


def database_url() -> str:
    url = get_settings().database_url
    if not url:
        raise RuntimeError("Set DATABASE_URL in backend/.env (Supabase session pooler URL)")
    return async_url(url)


def run_migrations_offline() -> None:
    """Print the SQL instead of running it: alembic upgrade head --sql"""
    context.configure(
        url=get_settings().database_url or "postgresql+asyncpg://offline/roomify",
        target_metadata=target_metadata,
        include_object=include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection, target_metadata=target_metadata, include_object=include_object
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(database_url(), poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
