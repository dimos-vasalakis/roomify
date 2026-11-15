"""Real 3D models of the products, and the empty room's depth: made once, readable errors."""

from io import BytesIO
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.tools import model3d
from app.tools.fal_client import FalError, FalResult
from app.tools.product_views import ProductViews

PHOTO = "https://cdn2.jysk.com/getimage/wd3.medium/247385"
LARGE = "https://cdn2.jysk.com/getimage/wd3.large/247385"  # the shop's biggest copy is modelled


@pytest.fixture(autouse=True)
def nothing_measured(monkeypatch: pytest.MonkeyPatch) -> None:
    """Shells are measured and searched for furniture by their own calls, tested apart."""
    monkeypatch.setattr(model3d, "room_geometry", AsyncMock(side_effect=model3d.DepthError("off")))
    monkeypatch.setattr(model3d, "room_objects", AsyncMock(return_value=[]))


def post(url: str):  # type: ignore[no-untyped-def]
    with TestClient(app) as client:
        return client.post("/model3d", json={"image_url": url})


def test_a_product_photo_becomes_a_glb_once(monkeypatch: pytest.MonkeyPatch) -> None:
    fal = AsyncMock(
        return_value=FalResult(data={"model_glb": {"url": "https://v3b.fal.media/m.glb"}})
    )
    monkeypatch.setattr(model3d, "fal", fal)
    assert post(PHOTO).json()["glb_url"] == "https://v3b.fal.media/m.glb"
    assert post(PHOTO).json() == {"glb_url": "https://v3b.fal.media/m.glb", "views": 1, "sides": []}
    assert fal.await_count == 1  # the second open is free
    assert fal.await_args.args[0] == "fal-ai/trellis-2"
    assert fal.await_args.args[1]["image_url"] == LARGE
    assert fal.await_args.args[1]["seed"] == 7  # same photo, same model


def test_the_older_model_stands_in_when_the_new_one_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    fal = AsyncMock(side_effect=[FalError("busy"),
                                 FalResult(data={"model_mesh": {"url": "https://v3b.fal.media/old.glb"}})])  # fmt: skip
    monkeypatch.setattr(model3d, "fal", fal)
    assert post(PHOTO).json()["glb_url"] == "https://v3b.fal.media/old.glb"


VIEWS = ProductViews(image_urls=[LARGE, LARGE + "b"], sides=["front", "back"])


def test_the_shops_photos_from_several_sides_make_one_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The back of the model is the shop's own photo of the back, not a guess."""
    views = AsyncMock(return_value=VIEWS)
    fal = AsyncMock(
        return_value=FalResult(data={"model_glb": {"url": "https://v3b.fal.media/mv.glb"}})
    )
    monkeypatch.setattr(model3d, "product_views", views)
    monkeypatch.setattr(model3d, "fal", fal)
    with TestClient(app) as client:
        got = client.post(
            "/model3d",
            json={"image_url": PHOTO, "page_url": "https://jysk.gr/a/b/c", "title": "Sofa"},
        )
    assert got.json() == {
        "glb_url": "https://v3b.fal.media/mv.glb",
        "views": 2,
        "sides": ["front", "back"],
    }
    views.assert_awaited_once_with(PHOTO, "https://jysk.gr/a/b/c", "Sofa")
    assert fal.await_args.args[0] == model3d.MULTI_MODEL
    assert fal.await_args.args[1]["image_urls"] == VIEWS.image_urls


def test_one_photo_stands_in_when_the_several_side_model_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fal = AsyncMock(side_effect=[FalError("busy"),
                                 FalResult(data={"model_glb": {"url": "https://v3b.fal.media/one.glb"}})])  # fmt: skip
    monkeypatch.setattr(model3d, "product_views", AsyncMock(return_value=VIEWS))
    monkeypatch.setattr(model3d, "fal", fal)
    got = post(PHOTO).json()
    assert got == {"glb_url": "https://v3b.fal.media/one.glb", "views": 1, "sides": []}
    assert [c.args[0] for c in fal.await_args_list] == [model3d.MULTI_MODEL, model3d.MODEL]


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


async def test_optional_room_measurements_and_objects_cannot_hold_the_shell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio

    async def slow(*_args: object) -> None:
        await asyncio.sleep(10)

    monkeypatch.setattr(model3d, "ENRICH_TIMEOUT_S", 0.01)
    monkeypatch.setattr(model3d, "room_geometry", slow)
    monkeypatch.setattr(model3d, "room_objects", slow)
    shell = model3d.PhotoDepth(
        image_url="https://v3b.fal.media/room.jpg",
        depth_url="https://v3b.fal.media/depth.png", width=30, height=20,
    )
    result = await model3d._measured(shell)
    assert result.geometry is None
    assert result.objects == []
    assert result.image_url == shell.image_url


async def test_model_fallbacks_share_one_total_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    async def slow(*_args: object) -> None:
        await asyncio.sleep(10)

    monkeypatch.setattr(model3d, "PRODUCT_TIMEOUT_S", 0.01)
    monkeypatch.setattr(model3d, "product_views", slow)
    with pytest.raises(model3d.Model3DError, match="took too long"):
        await model3d.product_model(PHOTO)
