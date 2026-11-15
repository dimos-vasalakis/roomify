"""Real 3D models of the products, and the empty room's depth: made once, readable errors."""

from io import BytesIO
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.tools import model3d
from app.tools.fal_client import FalError, FalResult

PHOTO = "https://cdn2.jysk.com/getimage/wd3.medium/247385"


def post(url: str):  # type: ignore[no-untyped-def]
    with TestClient(app) as client:
        return client.post("/model3d", json={"image_url": url})


def test_a_product_photo_becomes_a_glb_once(monkeypatch: pytest.MonkeyPatch) -> None:
    fal = AsyncMock(
        return_value=FalResult(data={"model_glb": {"url": "https://v3b.fal.media/m.glb"}})
    )
    monkeypatch.setattr(model3d, "fal", fal)
    assert post(PHOTO).json() == {"glb_url": "https://v3b.fal.media/m.glb"}
    assert post(PHOTO).json() == {"glb_url": "https://v3b.fal.media/m.glb"}
    assert fal.await_count == 1  # the second open is free
    assert fal.await_args.args[0] == "fal-ai/trellis-2"
    assert fal.await_args.args[1]["seed"] == 7  # same photo, same model


def test_the_older_model_stands_in_when_the_new_one_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    fal = AsyncMock(side_effect=[FalError("busy"),
                                 FalResult(data={"model_mesh": {"url": "https://v3b.fal.media/old.glb"}})])  # fmt: skip
    monkeypatch.setattr(model3d, "fal", fal)
    assert post(PHOTO).json() == {"glb_url": "https://v3b.fal.media/old.glb"}


def test_private_or_plain_http_photos_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    fal = AsyncMock()
    monkeypatch.setattr(model3d, "fal", fal)
    for url in ["http://cdn2.jysk.com/x.jpg", "https://127.0.0.1/x.jpg", "https://localhost/x.jpg"]:
        assert post(url).status_code == 422
    fal.assert_not_awaited()


def test_new_models_have_an_hourly_ceiling(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(model3d, "NEW_PER_HOUR", 1)
    monkeypatch.setattr(model3d, "_made", model3d.deque())
    monkeypatch.setattr(
        model3d,
        "fal",
        AsyncMock(return_value=FalResult(data={"model_glb": {"url": "https://x.fal.media/a.glb"}})),
    )
    assert post(PHOTO + "?a").status_code == 200
    blocked = post(PHOTO + "?b")
    assert blocked.status_code == 429
    assert "this hour" in blocked.json()["detail"]


def test_the_empty_room_photo_gets_its_depth_once(monkeypatch: pytest.MonkeyPatch) -> None:
    upload = AsyncMock(return_value="https://v3b.fal.media/room.jpg")
    depth = AsyncMock(
        return_value=model3d.Depth(depth_url="https://v3b.fal.media/d.png", width=30, height=20)
    )
    monkeypatch.setattr(model3d, "fal_upload", upload)
    monkeypatch.setattr(model3d, "depth_map", depth)
    image = BytesIO()
    Image.new("RGB", (30, 20)).save(image, "JPEG")
    with TestClient(app) as client:
        for _ in range(2):
            got = client.post(
                "/depth/photo", files={"photo": ("room.jpg", image.getvalue(), "image/jpeg")}
            )
            assert got.json()["depth_url"] == "https://v3b.fal.media/d.png"
            assert got.json()["image_url"] == "https://v3b.fal.media/room.jpg"
    assert upload.await_count == 1


SHELL = {
    "render_url": "https://v3b.fal.media/render.jpg",
    "pieces": [{"name": "sofa: HELLERUP beige", "box": {"x": 0.3, "y": 0.6, "w": 0.4, "h": 0.3}}],
}


def test_the_shell_is_the_render_without_its_pieces_made_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A sofa the design replaced stayed in the 3D room when the shell was the person's photo."""
    fal = AsyncMock(
        return_value=FalResult(data={"images": [{"url": "https://v3b.fal.media/empty.jpg"}]})
    )
    depth = AsyncMock(
        return_value=model3d.Depth(depth_url="https://v3b.fal.media/d.png", width=30, height=20)
    )
    monkeypatch.setattr(model3d, "fal", fal)
    monkeypatch.setattr(model3d, "depth_map", depth)
    with TestClient(app) as client:
        for _ in range(2):
            got = client.post("/depth/shell", json=SHELL).json()
            assert got["image_url"] == "https://v3b.fal.media/empty.jpg"
            assert got["depth_url"] == "https://v3b.fal.media/d.png"
    assert fal.await_count == 1
    arguments = fal.await_args.args[1]
    assert arguments["image_urls"] == [SHELL["render_url"]]
    assert "sofa: HELLERUP beige (in the lower middle of the picture)" in arguments["prompt"]
    depth.assert_awaited_once_with("https://v3b.fal.media/empty.jpg")


def test_only_roomify_renders_get_a_shell() -> None:
    with TestClient(app) as client:
        got = client.post("/depth/shell", json=SHELL | {"render_url": "https://example.com/a.jpg"})
    assert got.status_code == 422
