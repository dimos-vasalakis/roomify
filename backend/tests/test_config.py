import pytest

from app import storage
from app.config import get_settings
from app.db.session import async_url


def test_async_url_adds_driver() -> None:
    assert async_url("postgresql://u:p@h:5432/db") == "postgresql+asyncpg://u:p@h:5432/db"
    assert async_url("postgres://u:p@h/db") == "postgresql+asyncpg://u:p@h/db"


def test_replay_turns_database_and_storage_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REPLAY", "1")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    settings = get_settings()
    assert not settings.db_enabled
    assert not settings.storage_enabled


def test_live_mode_turns_database_and_storage_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REPLAY", "0")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co/")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    settings = get_settings()
    assert settings.db_enabled
    assert settings.storage_enabled
    assert settings.supabase_url == "https://x.supabase.co"


async def test_storage_gives_readable_error_when_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REPLAY", "1")
    with pytest.raises(storage.StorageError, match="Storage is off"):
        await storage.upload("runs/x/photo.jpg", b"jpg", "image/jpeg")
