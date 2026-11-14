from collections.abc import Iterator

import pytest

from app.config import get_settings
from app.db.session import get_engine


@pytest.fixture(autouse=True)
def fresh_settings() -> Iterator[None]:
    """Settings and engine are cached; reset them so each test sees its own env."""
    get_settings.cache_clear()
    get_engine.cache_clear()
    yield
    get_settings.cache_clear()
    get_engine.cache_clear()
