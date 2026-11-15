"""The walk-in preview: a video of the render, made once, honest errors, never anyone's link."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.tools import walkin
from app.tools.fal_client import FalError, FalResult

RENDER = "https://v3b.fal.media/files/b/x/room.jpg"


def post(url: str = RENDER):  # type: ignore[no-untyped-def]
    with TestClient(app) as client:
        return client.post("/walkin", json={"render_url": url})


def test_a_render_becomes_a_walk_in_once(monkeypatch: pytest.MonkeyPatch) -> None:
    fal = AsyncMock(return_value=FalResult(data={"video": {"url": "https://v3b.fal.media/w.mp4"}}))
    monkeypatch.setattr(walkin, "fal", fal)
    assert post().json() == {"video_url": "https://v3b.fal.media/w.mp4"}
    assert post().json() == {"video_url": "https://v3b.fal.media/w.mp4"}
    assert fal.await_count == 1
    model, args = fal.await_args.args
    assert model == walkin.MODEL
    assert args["image_url"] == RENDER and args["duration"] == "5"
    assert "furniture" in args["negative_prompt"]


def test_the_other_video_model_stands_in(monkeypatch: pytest.MonkeyPatch) -> None:
    fal = AsyncMock(
        side_effect=[
            FalError("busy"),
            FalResult(data={"video": {"url": "https://x.fal.media/b.mp4"}}),
        ]
    )
    monkeypatch.setattr(walkin, "fal", fal)
    assert post().json() == {"video_url": "https://x.fal.media/b.mp4"}
    assert fal.await_args.args[0] == walkin.FALLBACK


def test_only_roomify_renders_and_readable_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    fal = AsyncMock(side_effect=FalError("down"))
    monkeypatch.setattr(walkin, "fal", fal)
    assert post("https://example.com/room.jpg").status_code == 422
    failed = post()
    assert failed.status_code == 502
    assert failed.json()["detail"] == "Couldn't make the walk-in preview. Try again."
