"""A real 3D model of a chosen product, made from the shop's own photos, for the 3D room.

The shop's gallery is sorted first (`product_views`): the photos of the whole product alone, and
from which side each was taken. Meshy turns up to four of them into one textured GLB, so the back
and sides of the model are the shop's photos, not a guess. With only one usable photo, TRELLIS-2
makes the model from it. Each model is made once and reused. Nothing about the product is
invented beyond what the shop's photos show.
"""

import asyncio
import hashlib
import logging
import time
from collections import deque

from pydantic import BaseModel, Field

from app.cache import ReplayMiss, cached
from app.tools.depth import Depth, DepthError, depth_map, fal_hosted
from app.tools.fal_client import FalError, fal, fal_upload
from app.tools.geometry import Geometry, room_geometry
from app.tools.product_views import product_views
from app.tools.room_objects import RoomObject, room_objects
from app.tools.web_fetch import is_public_url

log = logging.getLogger("roomify")
MULTI_MODEL = "fal-ai/meshy/v7.1/multi-image-to-3d"
MULTI_TIMEOUT_S = 210  # about three minutes in practice
MODEL = "fal-ai/trellis-2"
FALLBACK = "fal-ai/trellis"
TIMEOUT_S = 150
# New models are paid compute: a ceiling per hour, so a loop or a stranger can't run up a bill.
# Models already made are free and never count.
NEW_PER_HOUR = 40
_made: deque[float] = deque()


class Model3DError(Exception):
    """Readable error for the person looking at the room."""


class Model3D(BaseModel):
    glb_url: str
    views: int = 1  # how many of the shop's photos it was made from
    sides: list[str] = Field(default_factory=list)  # which side of the product each photo showed


def _arguments(image_url: str) -> dict[str, object]:
    return {
        "image_url": image_url,
        "seed": 7,
        "resolution": "1024",
        "decimation_target": 40000,  # light enough for a phone, enough for furniture
        "texture_size": "2048",
    }


def _multi_arguments(image_urls: list[str]) -> dict[str, object]:
    return {
        "image_urls": image_urls,
        "target_polycount": 40000,
        "symmetry_mode": "auto",
        "should_texture": True,
        "enable_pbr": True,
    }


def _room_for_one_more() -> bool:
    now = time.monotonic()
    while _made and now - _made[0] > 3600:
        _made.popleft()
    if len(_made) >= NEW_PER_HOUR:
        return False
    _made.append(now)
    return True


async def _from_one_photo(image_url: str) -> Model3D:
    async def make() -> Model3D:
        if not _room_for_one_more():
            raise Model3DError("Too many 3D models were made this hour. Try again later.")
        try:
            result = await fal(MODEL, _arguments(image_url), timeout=TIMEOUT_S, max_age_s=None)
            return Model3D(glb_url=result.data["model_glb"]["url"])
        except (FalError, KeyError, TypeError) as exc:
            log.warning("TRELLIS-2 failed (%s: %s); trying TRELLIS", exc, exc.__cause__)
        try:
            result = await fal(FALLBACK, {"image_url": image_url, "seed": 7, "texture_size": "1024"},
                               timeout=TIMEOUT_S, max_age_s=None)  # fmt: skip
            return Model3D(glb_url=result.data["model_mesh"]["url"])
        except (FalError, KeyError, TypeError) as exc:
            raise Model3DError("Couldn't make a 3D model of this piece.") from exc

    # One model per product photo, for good: the first person to open the room pays for it.
    return await cached("model3d", {"image_url": image_url, "model": MODEL}, make, Model3D, None)


async def _from_views(image_urls: list[str], sides: list[str]) -> Model3D:
    async def make() -> Model3D:
        if not _room_for_one_more():
            raise Model3DError("Too many 3D models were made this hour. Try again later.")
        try:
            result = await fal(MULTI_MODEL, _multi_arguments(image_urls),
                               timeout=MULTI_TIMEOUT_S, max_age_s=None)  # fmt: skip
            return Model3D(
                glb_url=result.data["model_glb"]["url"], views=len(image_urls), sides=sides
            )
        except (FalError, KeyError, TypeError) as exc:
            raise Model3DError("Couldn't make a 3D model from the shop's photos.") from exc

    inputs = {"image_urls": image_urls, "model": MULTI_MODEL}
    return await cached("model3d", inputs, make, Model3D, None)


async def product_model(image_url: str, page_url: str | None = None, title: str = "") -> Model3D:
    """The product from every side its shop photographed, or from its main photo alone."""
    if not (image_url.startswith("https://") and is_public_url(image_url)):
        raise Model3DError("That product photo can't be used for a 3D model.")
    views = await product_views(image_url, page_url, title)
    if len(views.image_urls) >= 2:
        try:
            return await _from_views(views.image_urls, views.sides)
        except Model3DError as exc:
            log.warning("Multi-view model failed (%s); one photo instead", exc)
    return await _from_one_photo(views.image_urls[0])


class PhotoDepth(Depth):
    image_url: str  # the photo on fal storage, same pixels as sent
    geometry: Geometry | None = None  # the room in metres, when it could be measured
    objects: list[RoomObject] = Field(
        default_factory=list
    )  # what already stands in it, cut out to be modelled


async def _measured(shell: PhotoDepth) -> PhotoDepth:
    """The shell with the room's real size and what stands in it added. Without either the 3D
    room still opens: sized from the depth map, with those things painted on its surfaces."""

    async def geometry() -> Geometry | None:
        try:
            return await room_geometry(shell.image_url)
        except (DepthError, ReplayMiss) as exc:
            log.warning("Room not measured (%s)", exc)
            return None

    measured, objects = await asyncio.gather(geometry(), room_objects(shell.image_url))
    return shell.model_copy(update={"geometry": measured, "objects": objects})


async def photo_depth(photo: bytes) -> PhotoDepth:
    """Depth of the person's own (empty) room photo: the shell of the 3D room."""
    digest = hashlib.sha256(photo).hexdigest()

    async def make() -> PhotoDepth:
        try:
            url = await fal_upload(photo, "image/jpeg", "room.jpg")
        except FalError as exc:
            raise DepthError("Couldn't read the room's depth. Try again.") from exc
        depth = await depth_map(url)
        return PhotoDepth(**depth.model_dump(), image_url=url)

    return await _measured(await cached("photo_depth", {"sha256": digest}, make, PhotoDepth, None))


SHELL_MODEL = "fal-ai/nano-banana-2/edit"
SHELL_TIMEOUT_S = 120


class Box(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class ShellPiece(BaseModel):
    name: str = Field(min_length=1, max_length=200)  # "sofa: HELLERUP 3-seater beige"
    box: Box  # where the render shows it, 0 to 1 of the frame


def _where(box: Box) -> str:
    """Plain words for where a piece stands in the picture: the image model reads words."""
    cx, cy = box.x + box.w / 2, box.y + box.h / 2
    across = "left" if cx < 0.36 else "right" if cx > 0.64 else "middle"
    down = "upper" if cy < 0.4 else "lower" if cy > 0.65 else "middle"
    return f"in the {down} {across} of the picture" if down != "middle" or across != "middle" \
        else "in the middle of the picture"  # fmt: skip


async def room_shell(render_url: str, pieces: list[ShellPiece]) -> PhotoDepth:
    """The finished room with the chosen pieces taken out, and its depth: the shell the 3D models
    stand in. Built from the person's photo instead, a sofa the design replaced stayed in the 3D
    room, stretched into streaks, with the new sofa's model standing in it."""
    if not fal_hosted(render_url):
        raise DepthError("Only a Roomify preview can be shown in 3D.")
    # The same pieces in any order are the same shell: the agent prepares it, the page asks for it.
    pieces = sorted(pieces, key=lambda p: (p.name, p.box.x, p.box.y))

    async def make() -> PhotoDepth:
        named = "; ".join(f"{p.name} ({_where(p.box)})" for p in pieces)
        prompt = (
            f"Reference 1 is a photo of a furnished room. Take out only these pieces: {named}. "
            "Where each stood, show what would naturally be behind and under it: the same floor, "
            "rug, skirting and wall, continuing their pattern and light. Change nothing else: "
            "every wall, window, door and every other object stays exactly where and as it is, "
            "with the same camera, framing, lens and light. Add nothing. Photorealistic, no text."
        )
        try:
            result = await fal(SHELL_MODEL, {
                "prompt": prompt, "image_urls": [render_url], "num_images": 1,
                "aspect_ratio": "3:2", "output_format": "jpeg", "resolution": "1K",
                "thinking_level": "minimal",
            }, timeout=SHELL_TIMEOUT_S, max_age_s=None)  # fmt: skip
            url = result.data["images"][0]["url"]
        except (FalError, KeyError, IndexError, TypeError) as exc:
            raise DepthError("Couldn't prepare the room for 3D. Try again.") from exc
        depth = await depth_map(url)
        return PhotoDepth(**depth.model_dump(), image_url=url)

    inputs = {"render_url": render_url, "pieces": [p.model_dump() for p in pieces]}
    # The same render and pieces always give the same shell: made once, then instant.
    return await _measured(await cached("room_shell", inputs, make, PhotoDepth, None))
