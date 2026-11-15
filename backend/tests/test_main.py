import logging
import time

import pytest
from fastapi.testclient import TestClient

from app import main


def test_startup_refresh_runs_in_the_background_and_logs_failures(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("REFRESH_CATALOGUES", "1")
    from app.config import get_settings

    get_settings.cache_clear()

    async def refresh() -> list[str]:
        return ["Could not get JYSK's product list (jysk.gr refused the request)"]

    monkeypatch.setattr(main, "refresh_catalogues", refresh)
    monkeypatch.setattr(main, "STARTUP_DELAY_S", 0.01)
    with caplog.at_level(logging.WARNING, logger="roomify"), TestClient(main.app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        deadline = time.time() + 5
        while "refused the request" not in caplog.text and time.time() < deadline:
            time.sleep(0.02)
    assert "Catalogue refresh: Could not get JYSK's product list" in caplog.text


def test_replay_never_refreshes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REFRESH_CATALOGUES", "1")
    monkeypatch.setenv("REPLAY", "1")
    from app.config import get_settings

    get_settings.cache_clear()

    async def must_not_run() -> list[str]:
        raise AssertionError("replay must not touch the network")

    monkeypatch.setattr(main, "refresh_catalogues", must_not_run)
    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200
