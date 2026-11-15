"""Read and normalize images for vision, with bounded downloads and replay cache."""

import base64
from io import BytesIO

import httpx
from PIL import Image, ImageOps
from pydantic import BaseModel

from app.cache import cached
from app.tools.web_fetch import is_public_url


class ImageData(BaseModel):
    jpeg: str


def jpeg_image(data: bytes) -> bytes:
    with Image.open(BytesIO(data)) as image:
        image.thumbnail((1280, 1024))
        out = BytesIO()
        image.convert("RGB").save(out, "JPEG", quality=85)
        return out.getvalue()


# PNG and WebP can only decode at full size, and WebP takes ~15 MB per megapixel to do it.
# JPEGs (every phone photo, and every photo the front end sends) decode shrunk instead.
ROOM_MAX_PIXELS = 12_000_000


class PhotoTooLarge(ValueError):
    pass


def room_jpeg(data: bytes) -> bytes:
    """Centre-crop to 3:2 landscape and cap at 1536 × 1024, the geometry the render, the
    before/after reveal and the price dots share (docs/API.md), whatever the client sent."""
    with Image.open(BytesIO(data)) as image:
        if image.format != "JPEG" and image.width * image.height > ROOM_MAX_PIXELS:
            raise PhotoTooLarge(f"{image.width} × {image.height} pixels")
        # Shrink first: a 20 MP photo worked on at full size took ~470 MB and crashed the
        # 512 MB server. JPEGs decode straight at the smaller size. 3072 keeps the final
        # 1536 × 1024 crop sharp whichever way the photo is turned.
        image.thumbnail((3072, 3072))
        image = ImageOps.exif_transpose(image).convert("RGB")
        w, h = image.size
        cw, ch = (round(h * 1.5), h) if w / h > 1.5 else (w, round(w / 1.5))
        left, top = (w - cw) // 2, (h - ch) // 2
        image = image.crop((left, top, left + cw, top + ch))
        image.thumbnail((1536, 1024))
        out = BytesIO()
        image.save(out, "JPEG", quality=90)
        return out.getvalue()


async def image_data(url: str) -> bytes:
    if not is_public_url(url):  # image links come from shop pages: untrusted
        raise ValueError("Not a public image address")

    async def call() -> ImageData:
        async with (
            httpx.AsyncClient(timeout=15, follow_redirects=True) as client,
            client.stream("GET", url) as response,
        ):
            response.raise_for_status()
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 10 * 1024 * 1024:
                    raise ValueError("Image is too large")
        return ImageData(jpeg=base64.b64encode(jpeg_image(bytes(data))).decode())

    return base64.b64decode((await cached("images", {"url": url}, call, ImageData)).jpeg)
