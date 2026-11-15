"""How far each pixel of a finished render is from the camera, for the 3D view."""

from pydantic import BaseModel

from app.tools.fal_client import FalError, fal
from app.tools.shops import host_of

DEPTH_MODEL = "fal-ai/image-preprocessors/depth-anything/v2"


class DepthError(Exception):
    """Readable error for the person looking at the room."""


class Depth(BaseModel):
    """A grayscale map the size of the render: white is near, black is far."""

    depth_url: str
    width: int
    height: int


def fal_hosted(url: str) -> bool:
    host = host_of(url)
    return url.startswith("https://") and (host == "fal.media" or host.endswith(".fal.media"))


async def depth_map(image_url: str) -> Depth:
    """Only our own renders: never a proxy for any link on the web."""
    if not fal_hosted(image_url):
        raise DepthError("Only a Roomify preview can be shown in 3D.")
    try:
        # The same render always has the same depth, so a saved map is reused forever.
        result = await fal(DEPTH_MODEL, {"image_url": image_url}, timeout=45, max_age_s=None)
        image = result.data["image"]
        return Depth(depth_url=image["url"], width=image["width"], height=image["height"])
    except FalError as exc:
        raise DepthError("Couldn't read the room's depth. Try again.") from exc
    except (KeyError, TypeError) as exc:
        raise DepthError("The depth of the room came back in a shape we couldn't read.") from exc
