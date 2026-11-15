"""A real 3D model of a chosen product, made from the shop's own photo, for the 3D room.

TRELLIS-2 on fal turns one product photo into a textured GLB. The same photo always gives the
same model (fixed seed), so each is made once and reused. The shop's photo is the only input:
nothing about the product is invented beyond what that photo shows.
"""

import hashlib
import logging
import time
from collections import deque

from pydantic import BaseModel

from app.cache import cached
from app.tools.depth import Depth, DepthError, depth_map
from app.tools.fal_client import FalError, fal, fal_upload
from app.tools.web_fetch import is_public_url

log = logging.getLogger("roomify")
MODEL = "fal-ai/trellis-2"
FALLBACK = "fal-ai/trellis"
TIMEOUT_S = 240
# New models are paid compute: a ceiling per hour, so a loop or a stranger can't run up a bill.
# Models already made are free and never count.
NEW_PER_HOUR = 60
_made: deque[float] = deque()


class Model3DError(Exception):
    """Readable error for the person looking at the room."""


class Model3D(BaseModel):
    glb_url: str


def _arguments(image_url: str) -> dict[str, object]:
    return {
        "image_url": image_url,
        "seed": 7,
        "resolution": "1024",
        "decimation_target": 40000,  # light enough for a phone, enough for furniture
        "texture_size": "2048",
    }


def _room_for_one_more() -> bool:
    now = time.monotonic()
    while _made and now - _made[0] > 3600:
        _made.popleft()
    if len(_made) >= NEW_PER_HOUR:
        return False
    _made.append(now)
    return True


async def product_model(image_url: str) -> Model3D:
    if not (image_url.startswith("https://") and is_public_url(image_url)):
        raise Model3DError("That product photo can't be used for a 3D model.")

    async def make() -> Model3D:
        if not _room_for_one_more():
            raise Model3DError("Too many 3D models were made this hour. Try again later.")
        try:
            result = await fal(MODEL, _arguments(image_url), timeout=TIMEOUT_S, max_age_s=None)
            return Model3D(glb_url=result.data["model_glb"]["url"])
        except (FalError, KeyError, TypeError) as exc:
            log.warning("TRELLIS-2 failed (%s); trying TRELLIS", type(exc).__name__)
        try:
            result = await fal(FALLBACK, {"image_url": image_url, "seed": 7, "texture_size": "1024"},
                               timeout=TIMEOUT_S, max_age_s=None)  # fmt: skip
            return Model3D(glb_url=result.data["model_mesh"]["url"])
        except (FalError, KeyError, TypeError) as exc:
            raise Model3DError("Couldn't make a 3D model of this piece.") from exc

    # One model per product photo, for good: the first person to open the room pays for it.
    return await cached("model3d", {"image_url": image_url, "model": MODEL}, make, Model3D, None)


class PhotoDepth(Depth):
    image_url: str  # the photo on fal storage, same pixels as sent


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

    return await cached("photo_depth", {"sha256": digest}, make, PhotoDepth, None)
