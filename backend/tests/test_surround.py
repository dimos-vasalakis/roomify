"""The room around the photo, imagined for the 3D room: made once, the photo kept in the middle,
honest when it can't be made."""

import io
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.tools import surround as tool
from app.tools.fal_client import FalError, FalResult

ROOM = "https://v3b.fal.media/files/b/x/empty-room.jpg"


def jpeg(w: int, h: int, colour=(200, 40, 40)) -> bytes:  # type: ignore[no-untyped-def]
    out = io.BytesIO()
    Image.new("RGB", (w, h), colour).save(out, "JPEG")
    return out.getvalue()


def post(url: str = ROOM):  # type: ignore[no-untyped-def]
    with TestClient(app) as client:
        return client.post("/depth/surround", json={"image_url": url})


@pytest.fixture
def fal(monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    monkeypatch.setattr(tool, "image_data", AsyncMock(return_value=jpeg(300, 200)))
    monkeypatch.setattr(tool, "fal_upload", AsyncMock(return_value="https://v3b.fal.media/pad.jpg"))

    async def edit(model: str, args: dict, **_: object) -> FalResult:
        name = "wide" if args["image_urls"] == ["https://v3b.fal.media/pad.jpg"] else "behind"
        return FalResult(data={"images": [{"url": f"https://v3b.fal.media/{name}.jpg"}]})

    mock = AsyncMock(side_effect=edit)
    monkeypatch.setattr(tool, "fal", mock)
    return mock


def test_the_photo_sits_in_the_middle_of_a_wider_grey_frame() -> None:
    pad, widen = tool.padded(jpeg(300, 200))
    image = Image.open(io.BytesIO(pad)).convert("RGB")
    assert image.size == (467, 200) and widen == pytest.approx(467 / 300)
    assert image.getpixel((5, 100)) == pytest.approx(tool.GREY, abs=6)
    assert image.getpixel((233, 100))[0] > 180  # the photo, untouched, in the middle
    with pytest.raises(tool.SurroundError):
        tool.padded(jpeg(460, 200))  # already panoramic


def test_a_room_gets_its_sides_and_the_wall_behind_once(fal) -> None:  # type: ignore[no-untyped-def]
    first, again = post().json(), post().json()
    assert first == again == {"wide_url": "https://v3b.fal.media/wide.jpg", "widen": pytest.approx(1.5567, abs=1e-3),
                              "behind_url": "https://v3b.fal.media/behind.jpg"}  # fmt: skip
    assert fal.await_count == 2


def test_without_the_wall_behind_the_sides_still_come(fal) -> None:  # type: ignore[no-untyped-def]
    async def edit(model: str, args: dict, **_: object) -> FalResult:
        if args["image_urls"] == [ROOM]:
            raise FalError("busy")
        return FalResult(data={"images": [{"url": "https://v3b.fal.media/wide.jpg"}]})

    fal.side_effect = edit
    assert post().json()["behind_url"] is None


def test_only_our_pictures_and_readable_failures(fal) -> None:  # type: ignore[no-untyped-def]
    assert post("https://example.com/room.jpg").status_code == 422
    fal.side_effect = FalError("down")
    failed = post()
    assert failed.status_code == 502
    assert failed.json()["detail"] == "Couldn't imagine the rest of the room. Try again."
