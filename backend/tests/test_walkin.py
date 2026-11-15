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


ARRIVAL = "https://v3b.fal.media/files/b/x/arrival.jpg"


def by_model(**answers):  # type: ignore[no-untyped-def]
    """A fake fal that answers per model: a list is answered in order, an error is raised."""

    async def call(model: str, args: dict, **_: object) -> FalResult:
        answer = answers[model]
        if isinstance(answer, list):
            answer = answer.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return FalResult(data=answer)

    return AsyncMock(side_effect=call)


def video(url: str) -> dict:
    return {"video": {"url": url}}


def test_a_render_becomes_a_walk_to_a_drawn_arrival_once(monkeypatch: pytest.MonkeyPatch) -> None:
    fal = by_model(**{walkin.VIEW_MODEL: {"images": [{"url": ARRIVAL}]},
                      walkin.MODEL: video("https://v3b.fal.media/w.mp4")})  # fmt: skip
    monkeypatch.setattr(walkin, "fal", fal)
    assert post().json() == {"video_url": "https://v3b.fal.media/w.mp4"}
    assert post().json() == {"video_url": "https://v3b.fal.media/w.mp4"}
    assert [c.args[0] for c in fal.await_args_list] == [walkin.VIEW_MODEL, walkin.MODEL]
    _, args = fal.await_args.args
    assert args["image_url"] == RENDER and args["tail_image_url"] == ARRIVAL
    assert args["duration"] == "5" and "furniture" in args["negative_prompt"]


def test_without_an_arrival_it_still_moves_from_the_one_picture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fal = by_model(**{walkin.VIEW_MODEL: FalError("busy"),
                      walkin.MODEL: video("https://v3b.fal.media/one.mp4")})  # fmt: skip
    monkeypatch.setattr(walkin, "fal", fal)
    assert post().json() == {"video_url": "https://v3b.fal.media/one.mp4"}
    assert "tail_image_url" not in fal.await_args.args[1]


def test_the_other_video_model_stands_in(monkeypatch: pytest.MonkeyPatch) -> None:
    fal = by_model(**{walkin.VIEW_MODEL: {"images": [{"url": ARRIVAL}]},
                      walkin.MODEL: FalError("busy"),
                      walkin.FALLBACK: video("https://x.fal.media/b.mp4")})  # fmt: skip
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
