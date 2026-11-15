"""What the photo didn't show, imagined, for the 3D room's walls, floor and ceiling.

Two image edits of the empty room, made once per room and kept:
- wide: the same picture with its sides continued, as a wider lens at the same spot would see
  them. The photo sits in the middle, so the 3D room projects it with the same camera: the side
  walls and floor beyond the photo's frame line up with what the photo did see.
- behind: the room seen from its far wall looking back, so the wall behind the photographer and
  the near halves of the side walls are seen whole, as a person would photograph them.

Only ever drawn where the photo saw nothing, and the 3D view says those parts are imagined."""

import asyncio
import hashlib
import io

import httpx
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from app.cache import cached
from app.tools.depth import fal_hosted
from app.tools.fal_client import FalError, fal, fal_upload
from app.tools.image_data import image_data

MODEL = "fal-ai/nano-banana-2/edit"
TIMEOUT_S = 120
WIDE = 21 / 9  # the widest frame the image model makes
GREY = (128, 128, 128)

WIDE_PROMPT = (
    "Image 1 is a photo of a room with flat grey bands on its left and right. Replace the grey "
    "bands by continuing the same room outwards, exactly as a wider lens standing at the same "
    "spot would see it: the same walls, corners, floor material, skirting, ceiling, light and "
    "style, with plausible room corners, doors or windows. Keep the photo in the middle exactly "
    "as it is, pixel for pixel. In the new parts no furniture, no people, no text: only the "
    "room itself. Photorealistic, level, the same perspective."
)
BEHIND_PROMPT = (
    "Image 1 is a photo of a room. Show the SAME room photographed from the other end: standing "
    "against the far wall that image 1 looks at, looking back towards where image 1 was taken. "
    "Show the wall behind the person who took image 1, which image 1 does not show, both side "
    "walls running towards it, the floor and the ceiling. The same floor material, wall colour, "
    "skirting, ceiling, light and style, with a plausible door or window. Empty: no furniture, no "
    "people, no text. Eye height, level, straight on. Photorealistic, wide landscape."
)


class SurroundError(Exception):
    """Plain words for the person waiting on the 3D room."""


class Surround(BaseModel):
    wide_url: str
    # How many times wider than the photo the wide picture is: its lens, for the 3D room.
    widen: float
    behind_url: str | None = None


def padded(photo: bytes) -> tuple[bytes, float]:
    """The photo in the middle of a 21:9 frame of plain grey, and how much wider the frame is."""
    image = Image.open(io.BytesIO(photo)).convert("RGB")
    w, h = image.size
    widen = max(1.0, WIDE / (w / h))
    if widen < 1.15:  # already panoramic: nothing worth imagining at the sides
        raise SurroundError("This photo is already as wide as the 3D room can use.")
    canvas = Image.new("RGB", (round(w * widen), h), GREY)
    canvas.paste(image, ((canvas.width - w) // 2, 0))
    out = io.BytesIO()
    canvas.save(out, "JPEG", quality=92)
    return out.getvalue(), canvas.width / w


async def _edit(prompt: str, image_url: str) -> str:
    result = await fal(MODEL, {"prompt": prompt, "image_urls": [image_url], "num_images": 1,
                               "aspect_ratio": "21:9", "output_format": "jpeg"},
                       timeout=TIMEOUT_S, max_age_s=None)  # fmt: skip
    return str(result.data["images"][0]["url"])


async def surround(image_url: str) -> Surround:
    """The room around the photo, imagined once per room picture."""
    if not fal_hosted(image_url):
        raise SurroundError("Only a room picture Roomify holds can be extended.")

    async def make() -> Surround:
        try:
            photo = await image_data(image_url)
            pad, widen = padded(photo)
            pad_url = await fal_upload(pad, "image/jpeg", "room-wide.jpg")
        except (httpx.HTTPError, OSError, ValueError, UnidentifiedImageError, FalError) as exc:
            raise SurroundError("Couldn't prepare the room's surroundings. Try again.") from exc
        wide, behind = await asyncio.gather(
            _edit(WIDE_PROMPT, pad_url), _edit(BEHIND_PROMPT, image_url), return_exceptions=True
        )
        if not isinstance(wide, str):
            raise SurroundError("Couldn't imagine the rest of the room. Try again.") from wide
        return Surround(
            wide_url=wide,
            widen=round(widen, 4),
            behind_url=behind if isinstance(behind, str) else None,
        )

    key = {"image": hashlib.sha256(image_url.encode()).hexdigest(), "model": MODEL, "v": 2}
    return await cached("surround", key, make, Surround, None)
