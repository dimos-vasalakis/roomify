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


async def test_bad_storage_answer_gives_no_link_instead_of_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("REPLAY", "0")
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    original = storage.httpx.AsyncClient

    def fake_client(**kwargs: object) -> object:
        transport = storage.httpx.MockTransport(
            lambda _request: storage.httpx.Response(200, text="<html>captive portal</html>")
        )
        return original(transport=transport, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(storage.httpx, "AsyncClient", fake_client)
    assert await storage.try_signed_url("avatars/x") is None


def test_cache_folder_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CACHE_DIR")
    monkeypatch.setenv("REPLAY", "0")
    assert get_settings().cache_dir.parts[-2:] == ("backend", ".cache")  # gitignored
    get_settings.cache_clear()
    monkeypatch.setenv("REPLAY", "1")
    assert get_settings().cache_dir.parts[-2:] == ("demo", "cache")  # the committed recording
