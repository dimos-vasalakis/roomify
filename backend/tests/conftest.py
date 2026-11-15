from collections.abc import Iterator
from pathlib import Path

import pytest

from app.config import get_settings
from app.db.session import get_engine

ALL_SHOPS = "ikea.gr,jysk.gr,praktiker.gr,plaisio.gr,pepco.gr"


@pytest.fixture(autouse=True)
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests never write to demo/cache and never depend on the developer's .env choices."""
    monkeypatch.setenv("CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("RETAILERS", ALL_SHOPS)
    monkeypatch.setenv("SERPER_API_KEY", "")
    monkeypatch.setenv("FIRECRAWL_API_KEY", "")
    monkeypatch.setenv("REPLAY", "0")
    monkeypatch.setenv("REFRESH_CATALOGUES", "0")


@pytest.fixture(autouse=True)
def fresh_settings() -> Iterator[None]:
    """Settings and engine are cached; reset them so each test sees its own env."""
    get_settings.cache_clear()
    get_engine.cache_clear()
    yield
    get_settings.cache_clear()
    get_engine.cache_clear()
