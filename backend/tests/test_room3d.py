"""The 3D room's inputs: the shop's photos from every side, the room measured in metres, and
what already stands in it."""

import struct
from unittest.mock import AsyncMock

import pytest

from app.tools import geometry, product_views, room_objects
from app.tools.product_views import pick


def test_the_front_comes_first_then_the_sides_it_does_not_show() -> None:
    whole = [
        ("a", "front-left"),
        ("b", "front"),
        ("c", "back"),
        ("d", "front-right"),
        ("e", "left"),
    ]
    assert pick(whole) == [("b", "front"), ("c", "back"), ("a", "front-left"), ("d", "front-right")]
    assert pick([]) == []


def test_jysk_photos_are_read_at_their_largest() -> None:
    assert product_views.largest("https://cdn4.jysk.com/getimage/wd3.medium/238489") == (
        "https://cdn4.jysk.com/getimage/wd3.large/238489"
    )


async def test_only_whole_product_photos_are_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    """A close-up of the fabric or the sofa bed opened out would model something else."""
    gallery = ["https://cdn4.jysk.com/getimage/wd3.medium/1", "https://cdn4.jysk.com/getimage/wd3.medium/2",
               "https://cdn4.jysk.com/getimage/wd3.medium/3"]  # fmt: skip
    monkeypatch.setattr(product_views, "gallery", AsyncMock(return_value=gallery))
    monkeypatch.setattr(product_views, "_judge", AsyncMock(return_value=[
        ("https://cdn4.jysk.com/getimage/wd3.large/1", "front-left"),
        ("https://cdn4.jysk.com/getimage/wd3.large/3", "back"),
    ]))  # fmt: skip
    got = await product_views.product_views(gallery[0], "https://jysk.gr/a/b/c", "Sofa")
    assert got.image_urls == [
        "https://cdn4.jysk.com/getimage/wd3.large/1",
        "https://cdn4.jysk.com/getimage/wd3.large/3",
    ]
    assert got.sides == ["front-left", "back"]


async def test_without_a_gallery_the_main_photo_alone(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(product_views, "gallery", AsyncMock(return_value=[]))
    judge = AsyncMock()
    monkeypatch.setattr(product_views, "_judge", judge)
    got = await product_views.product_views("https://x.com/a.jpg", "https://x.com/p", "Lamp")
    assert got.image_urls == ["https://x.com/a.jpg"]
    judge.assert_not_awaited()


def _ply(points: list[tuple[float, float, float]]) -> bytes:
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {len(points)}\nproperty float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    )
    return header.encode() + b"".join(struct.pack("<3f3B", *p, 1, 2, 3) for p in points)


def test_the_point_cloud_becomes_a_grid_of_metres(monkeypatch: pytest.MonkeyPatch) -> None:
    """A 240-wide grid; the point straight ahead lands in its middle, 2 m away."""
    monkeypatch.setattr(geometry, "COLS", 4)
    # A 4 x 2 picture, fx = fy = 1 (fractions), centred: the middle grid point looks straight on.
    got = geometry.grid_from_points(
        _ply([(0.0, 0.0, -2.0), (0.0, 0.0, 1.0)]), 4, 2, 1.0, 1.0, 0.5, 0.5
    )
    assert (got.cols, got.rows) == (4, 2)
    middle = 1 * (got.cols + 1) + 2
    assert got.distance[middle] == 2.0
    assert sum(1 for d in got.distance if d) == 1  # the point behind the camera is dropped


def test_a_cut_short_point_cloud_is_refused() -> None:
    with pytest.raises(ValueError):
        geometry.grid_from_points(_ply([(0.0, 0.0, -2.0)])[:-4], 4, 2, 1.0, 1.0, 0.5, 0.5)


def test_object_boxes_are_read_as_gemini_gives_them() -> None:
    box = room_objects._box([600, 100, 880, 230])
    assert box is not None
    assert (round(box.x, 3), round(box.y, 3), round(box.w, 3), round(box.h, 3)) == (
        0.1,
        0.6,
        0.13,
        0.28,
    )
    assert room_objects._box([10, 10, 12, 12]) is None  # too small to be a thing
    assert room_objects._box("nonsense") is None
