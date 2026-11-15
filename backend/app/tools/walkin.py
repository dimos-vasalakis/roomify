"""The walk-in preview: a short camera move into the finished room, made by a video model from
the render. A preview of the picture, never called 3D, and never a new design: the prompt holds
every piece where it is and forbids adding or changing anything."""

import time
from collections import deque

from pydantic import BaseModel

from app.cache import cached
from app.tools.depth import fal_hosted
from app.tools.fal_client import FalError, fal

MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video"
FALLBACK = "fal-ai/minimax/hailuo-02/standard/image-to-video"
TIMEOUT_S = 300
# Videos are the dearest call we make: a ceiling per hour. Ones already made are free.
NEW_PER_HOUR = 20
_made: deque[float] = deque()

PROMPT = (
    "A slow, steady, cinematic dolly-in: the camera glides forward into this exact room at eye "
    "height, about one metre, smooth and level, ending a little closer to the furniture. The "
    "room, every piece of furniture, its shape, colour, material and position stay exactly as in "
    "the photo; only the camera moves. Natural daylight, realistic parallax, sharp detail. No "
    "people, no new objects, no text."
)
NEGATIVE = (
    "people, animals, new furniture, changing furniture, moving furniture, morphing, warping, "
    "melting, flicker, camera shake, fast motion, zoom blur, text, watermark, low quality"
)


class WalkinError(Exception):
    """Plain words for the person waiting on the preview."""


class Walkin(BaseModel):
    video_url: str


def _room_for_one_more() -> bool:
    now = time.monotonic()
    while _made and now - _made[0] > 3600:
        _made.popleft()
    if len(_made) >= NEW_PER_HOUR:
        return False
    _made.append(now)
    return True


async def walk_in(render_url: str) -> Walkin:
    """One preview per render, made once and kept."""
    if not fal_hosted(render_url):
        raise WalkinError("Only a Roomify preview can be walked into.")

    async def make() -> Walkin:
        if not _room_for_one_more():
            raise WalkinError("Too many walk-ins were made this hour. Try again later.")
        try:
            result = await fal(MODEL, {"prompt": PROMPT, "image_url": render_url, "duration": "5",
                                       "negative_prompt": NEGATIVE, "cfg_scale": 0.5},
                               timeout=TIMEOUT_S, max_age_s=None)  # fmt: skip
            return Walkin(video_url=result.data["video"]["url"])
        except (FalError, KeyError, TypeError):
            pass
        try:
            result = await fal(FALLBACK, {"prompt": PROMPT, "image_url": render_url, "duration": "6",
                                          "resolution": "768P", "prompt_optimizer": False},
                               timeout=TIMEOUT_S, max_age_s=None)  # fmt: skip
            return Walkin(video_url=result.data["video"]["url"])
        except (FalError, KeyError, TypeError) as exc:
            raise WalkinError("Couldn't make the walk-in preview. Try again.") from exc

    return await cached("walkin", {"render_url": render_url, "model": MODEL}, make, Walkin, None)
