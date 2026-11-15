"""The 3D view's depth map: only our own renders, readable errors, saved forever."""

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.main import app
from app.tools import depth as depth_tool
from app.tools.fal_client import FalError, FalResult

RENDER = "https://v3b.fal.media/files/b/x/room.jpg"


def post(url: str):
    with TestClient(app) as client:
        return client.post("/depth", json={"image_url": url})


def test_returns_the_depth_map(monkeypatch):
    fal = AsyncMock(
        return_value=FalResult(
            data={"image": {"url": "https://v3b.fal.media/d.png", "width": 30, "height": 20}}
        )
    )
    monkeypatch.setattr(depth_tool, "fal", fal)
    response = post(RENDER)
    assert response.status_code == 200
    assert response.json() == {
        "depth_url": "https://v3b.fal.media/d.png",
        "width": 30,
        "height": 20,
    }
    assert fal.await_args.kwargs["max_age_s"] is None


def test_refuses_links_that_are_not_our_renders(monkeypatch):
    fal = AsyncMock()
    monkeypatch.setattr(depth_tool, "fal", fal)
    for url in [
        "https://example.com/room.jpg",
        "http://v3b.fal.media/x.jpg",
        "https://fal.media.evil.com/x",
    ]:
        response = post(url)
        assert response.status_code == 422
        assert response.json()["detail"] == "Only a Roomify preview can be shown in 3D."
    fal.assert_not_awaited()


def test_a_failed_call_reads_as_a_sentence(monkeypatch):
    monkeypatch.setattr(depth_tool, "fal", AsyncMock(side_effect=FalError("took too long")))
    response = post(RENDER)
    assert response.status_code == 502
    assert response.json()["detail"] == "Couldn't read the room's depth. Try again."
