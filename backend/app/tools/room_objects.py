"""What already stands in the room (a side table, an ottoman, a coffee table), each cut out of the
picture, so the 3D room can model it too instead of painting it flat on the floor and walls.

Only things you could walk round are listed: walls, windows, curtains, rugs and pictures stay
painted on the room's surfaces, where they belong.
"""

import asyncio
import logging
from io import BytesIO

import httpx
from PIL import Image
from pydantic import BaseModel, Field

from app.cache import ReplayMiss, cached
from app.llm import LLMError, llm
from app.tools.fal_client import FalError, fal, fal_upload
from app.tools.image_data import image_data

log = logging.getLogger("roomify")
MAX_OBJECTS = 8
MIN_AREA = 0.004  # of the frame: smaller than that, a model can't be made from it
ISOLATE_MODEL = "fal-ai/nano-banana-2/edit"


class ObjectBox(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class RoomObject(BaseModel):
    name: str  # "side table"
    box: ObjectBox  # where the picture shows it, 0 to 1 of the frame
    on_top: bool  # stands on another listed object, not on the floor
    crop_url: str  # the object alone on white, drawn from its cut-out, to model from


class RoomObjects(BaseModel):
    objects: list[RoomObject]


PROMPT = """This is a photo of a room. List the separate objects standing in it that a person could
walk round: sofas, chairs, stools, ottomans, tables, side tables, desks, cabinets, shelves, beds,
floor lamps, table lamps, plants, vases or bowls on a table. Do NOT list walls, windows, doors,
curtains, blinds, rugs, pictures or mirrors on walls, ceiling lights, radiators, wall panelling or
anything built in. At most {n}, biggest first. For each: its name in a few English words; box_2d,
the whole object from its top to where it meets the floor, as [ymin, xmin, ymax, xmax] scaled 0 to
1000; and on_top: true if it stands on another object you listed.
Return JSON: {{"objects": [{{"name": "side table", "box_2d": [600, 100, 880, 230], "on_top": false}}]}}"""


def _crop(jpeg: bytes, box: ObjectBox) -> bytes:
    """The object with a margin round it, so the model sees all of its edges."""
    with Image.open(BytesIO(jpeg)) as image:
        w, h = image.size
        pad_x, pad_y = box.w * 0.08, box.h * 0.08
        left = max(0, round((box.x - pad_x) * w))
        top = max(0, round((box.y - pad_y) * h))
        right = min(w, round((box.x + box.w + pad_x) * w))
        bottom = min(h, round((box.y + box.h + pad_y) * h))
        out = BytesIO()
        image.crop((left, top, right, bottom)).convert("RGB").save(out, "JPEG", quality=92)
        return out.getvalue()


def _box(raw: object) -> ObjectBox | None:
    """[ymin, xmin, ymax, xmax] on 0 to 1000 into a box of fractions; None if it isn't one."""
    try:
        y0, x0, y1, x1 = (min(1000.0, max(0.0, float(v))) / 1000 for v in raw)  # type: ignore[union-attr]
    except (TypeError, ValueError):
        return None
    if x1 - x0 < 0.02 or y1 - y0 < 0.02:
        return None
    return ObjectBox(x=x0, y=y0, w=x1 - x0, h=y1 - y0)


async def _isolated(crop_url: str, name: str) -> str:
    """The object alone, whole, on white: a cut-out with the room round it (and a vase on it, or
    the frame's edge through it) gave a 3D model of the clutter. The cut-out itself if this fails."""
    prompt = (
        f"Reference 1 is a cut-out of a {name} from a photo of a room. One single photo of only that "
        f"{name}, once, whole and centred (not several views, not a collage), standing alone on a "
        "plain white background, from the same angle, with the same shape, "
        "colours, material and proportions. Remove everything else: the room, the floor, the rug, "
        "and anything standing on it or in front of it. Complete any part the cut-out hides. "
        "Product photo, soft even light, no shadow, no text."
    )
    try:
        result = await fal(ISOLATE_MODEL, {"prompt": prompt, "image_urls": [crop_url], "num_images": 1,
                                           "output_format": "jpeg", "resolution": "1K",
                                           "thinking_level": "minimal"}, timeout=60, max_age_s=None)  # fmt: skip
        return str(result.data["images"][0]["url"])
    except (FalError, KeyError, IndexError, TypeError) as exc:
        log.info("Couldn't isolate the %s (%s); modelling its cut-out", name, exc)
        return crop_url


async def room_objects(image_url: str) -> list[RoomObject]:
    """Same picture, same answer, for good. Never raises: a room without them still opens."""

    async def make() -> RoomObjects:
        jpeg = await image_data(image_url)
        answer = await llm(PROMPT.format(n=MAX_OBJECTS), images=[(jpeg, "image/jpeg")],
                           json_out=True, vision=True)  # fmt: skip
        found = []
        for item in (answer.get("objects") or [])[:MAX_OBJECTS] if isinstance(answer, dict) else []:
            box = _box(item.get("box_2d")) if isinstance(item, dict) else None
            if box and box.w * box.h >= MIN_AREA and str(item.get("name") or "").strip():
                found.append((str(item["name"]).strip()[:60], box, item.get("on_top") is True))

        async def cut(name: str, box: ObjectBox, on_top: bool) -> RoomObject | None:
            try:
                data = await asyncio.to_thread(_crop, jpeg, box)
                url = await fal_upload(data, "image/jpeg", "object.jpg")
            except (FalError, OSError) as exc:
                log.info("Couldn't cut out %s (%s)", name, exc)
                return None
            return RoomObject(
                name=name, box=box, on_top=on_top, crop_url=await _isolated(url, name)
            )

        cut_out = await asyncio.gather(*(cut(*f) for f in found))
        return RoomObjects(objects=[o for o in cut_out if o])

    try:
        return (
            await cached("room_objects", {"image_url": image_url}, make, RoomObjects, None)
        ).objects
    except (LLMError, ValueError, OSError, httpx.HTTPError, ReplayMiss) as exc:
        log.warning("Couldn't list what stands in the room (%s)", exc)
        return []
